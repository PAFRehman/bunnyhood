export type CheckerEligibility = "GTD" | "FCFS";

export type CheckerImport = {
  walletAddress: string;
  eligibilityType: CheckerEligibility;
};

export type CheckerImportDraft = {
  entries: CheckerImport[];
  gtd: number;
  fcfs: number;
  validUnique: number;
  fixedPrefixes: number;
  duplicatesRemoved: number;
  ignoredRows: number;
  crossListConflicts: number;
};

const EVM_WALLET_IN_TEXT = /(?:^|[^0-9a-fA-F])((?:0x)?[0-9a-fA-F]{40})(?![0-9a-fA-F])/g;

function parseWalletColumn(value: string) {
  const wallets = new Map<string, { fixedPrefix: boolean }>();
  let duplicatesRemoved = 0;
  let ignoredRows = 0;

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const matches = [...line.matchAll(EVM_WALLET_IN_TEXT)];
    if (!matches.length) {
      ignoredRows += 1;
      continue;
    }

    for (const match of matches) {
      const rawWallet = match[1];
      const fixedPrefix = !rawWallet.toLowerCase().startsWith("0x");
      const walletAddress = `${fixedPrefix ? "0x" : ""}${rawWallet}`.toLowerCase();

      if (wallets.has(walletAddress)) {
        duplicatesRemoved += 1;
        continue;
      }

      wallets.set(walletAddress, { fixedPrefix });
    }
  }

  return {
    wallets,
    duplicatesRemoved,
    ignoredRows,
  };
}

export function parseCheckerImportDraft(
  gtdValue: string,
  fcfsValue: string,
): CheckerImportDraft {
  const gtdDraft = parseWalletColumn(gtdValue);
  const fcfsDraft = parseWalletColumn(fcfsValue);
  const entries: CheckerImport[] = [];
  let fixedPrefixes = 0;
  let crossListConflicts = 0;

  for (const [walletAddress, details] of gtdDraft.wallets) {
    entries.push({ walletAddress, eligibilityType: "GTD" });
    if (details.fixedPrefix) fixedPrefixes += 1;
  }

  for (const [walletAddress, details] of fcfsDraft.wallets) {
    // A wallet has one saved checker status. If it appears in both boxes,
    // guaranteed access wins so spreadsheet overlap cannot downgrade it.
    if (gtdDraft.wallets.has(walletAddress)) {
      crossListConflicts += 1;
      continue;
    }

    entries.push({ walletAddress, eligibilityType: "FCFS" });
    if (details.fixedPrefix) fixedPrefixes += 1;
  }

  return {
    entries,
    gtd: gtdDraft.wallets.size,
    fcfs: entries.filter((entry) => entry.eligibilityType === "FCFS").length,
    validUnique: entries.length,
    fixedPrefixes,
    duplicatesRemoved: gtdDraft.duplicatesRemoved + fcfsDraft.duplicatesRemoved,
    ignoredRows: gtdDraft.ignoredRows + fcfsDraft.ignoredRows,
    crossListConflicts,
  };
}

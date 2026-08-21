import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8");
const context = { Date, JSON, Math, Number, String, Boolean, RegExp, isFinite, isNaN };
runInNewContext(source, context);

const userId = "2cc25023-6d57-4f83-a6d0-9e8f35aba51e";
const referrerId = "f77d0981-52dc-47c5-a6d1-dd609dc3d5b1";
const referralId = "0ef4b9de-5c0c-47e2-922c-3cf3015bc365";
const winId = "174411a1-33b3-4ee4-aae0-0569d632c9c2";

const canonicalUser = context.normalizedSpinUser_({
  userId,
  xUserId: "1787233682312",
  xUsername: "BunnysHood",
  xName: "Bunny Hood",
  spinsAvailable: 12,
  spinsUsed: 4,
  points: 3,
  totalWins: 1,
  referralCode: "bunny_member",
  referralCount: 2,
  referralSpinsEarned: 6,
  updatedAt: new Date().toISOString(),
});

const legacyUser = context.normalizedSpinUser_({
  id: userId,
  x_user_id: "1787233682312",
  username: "@BunnysHood",
  name: "Bunny Hood",
  spins: "12",
  spins_used: "4",
  points: "3",
  total_wins: "1",
  referral_code: "@bunny_member",
  updated_at: new Date().toISOString(),
});

const canonicalReferral = context.normalizedSpinReferral_({
  referralId,
  referrerUserId: referrerId,
  referredUserId: userId,
  referrerXUserId: "1787233682311",
  referredXUserId: "1787233682312",
  referrerUsername: "BunnyFriend",
  referredUsername: "BunnysHood",
  referralCode: "bunny_member",
  awardedSpins: 3,
  createdAt: new Date().toISOString(),
});

const legacyReferral = context.normalizedSpinReferral_({
  id: referralId,
  referrer_user_id: referrerId,
  referred_user_id: userId,
  referrer_x_user_id: "1787233682311",
  referred_x_user_id: "1787233682312",
  referrer_username: "@BunnyFriend",
  referred_username: "@BunnysHood",
  referral_code: "@bunny_member",
  awarded_spins: "3",
  created_at: new Date().toISOString(),
});

const canonicalWin = context.normalizedSpinWin_({
  winId,
  userId,
  xUserId: "1787233682312",
  xUsername: "BunnysHood",
  xName: "Bunny Hood",
  prizeType: "GTD",
  wonAt: new Date().toISOString(),
  wallet: "0x1111111111111111111111111111111111111111",
  walletSubmittedAt: new Date().toISOString(),
  walletChangeAllowed: true,
});

if (!canonicalUser || !legacyUser || !canonicalReferral || !legacyReferral || !canonicalWin) {
  throw new Error("A supported Google Sheets payload was rejected.");
}
if (legacyUser.xUsername !== "BunnysHood" || legacyReferral.referralCode !== "bunny_member") {
  throw new Error("Legacy Google Sheets payload normalization failed.");
}
if (context.normalizedSpinUser_({ userId, xUserId: "not-an-x-id", xUsername: "bad" })) {
  throw new Error("An invalid Google Sheets user payload was accepted.");
}

class MockRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ""));
  }

  setValues(values) {
    for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
      const targetRow = this.row - 1 + rowOffset;
      while (this.sheet.rows.length <= targetRow) this.sheet.rows.push([]);
      for (let columnOffset = 0; columnOffset < values[rowOffset].length; columnOffset += 1) {
        this.sheet.rows[targetRow][this.column - 1 + columnOffset] = values[rowOffset][columnOffset];
      }
    }
    return this;
  }
}

class MockSheet {
  constructor() {
    this.rows = [];
  }

  getLastRow() {
    return this.rows.length;
  }

  appendRow(row) {
    this.rows.push([...row]);
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new MockRange(this, row, column, rowCount, columnCount);
  }
}

const mockWorkbook = {
  sheets: new Map(),
  getSheetByName(name) {
    return this.sheets.get(name) ?? null;
  },
  insertSheet(name) {
    const sheet = new MockSheet();
    this.sheets.set(name, sheet);
    return sheet;
  },
};
context.SpreadsheetApp = { getActiveSpreadsheet: () => mockWorkbook };

const batch = context.handleBatch_([
  { deliveryKey: "1:1", eventType: "spin_user", payload: canonicalUser },
  { deliveryKey: "2:1", eventType: "spin_referral", payload: canonicalReferral },
  { deliveryKey: "3:1", eventType: "spin_win", payload: canonicalWin },
]);

if (!batch.ok || batch.results.some((result) => !result.ok)) {
  throw new Error("Google Sheets batch delivery rejected a canonical record.");
}
for (const name of ["Spin Users", "Spin Referrals", "Spin Wins"]) {
  if (mockWorkbook.getSheetByName(name)?.rows.length !== 2) {
    throw new Error(`${name} was not written in one bulk operation.`);
  }
}

const walletRemoval = context.handleBatch_([{
  deliveryKey: "3:2",
  eventType: "spin_win",
  payload: { ...canonicalWin, wallet: "", walletSubmittedAt: "" },
}]);
const savedWin = mockWorkbook.getSheetByName("Spin Wins")?.rows[1];
if (!walletRemoval.ok || !walletRemoval.results[0]?.ok || savedWin?.[7] !== "" || savedWin?.[8] !== "") {
  throw new Error("A removed wallet was not cleared from the existing Google Sheets win row.");
}

const repairedQueue = context.handleBatch_(Array.from({ length: 67 }, (_, index) => ({
  deliveryKey: `${index + 10}:2`,
  eventType: "spin_user",
  payload: {
    userId: randomUUID(),
    xUserId: String(1900000000000000000n + BigInt(index)),
    xUsername: `Bunny${index}`,
    xName: `Bunny Member ${index}`,
    spinsAvailable: index,
    spinsUsed: index,
    points: 3,
    totalWins: 0,
    updatedAt: new Date().toISOString(),
  },
})));
if (!repairedQueue.ok || repairedQueue.results.length !== 67 || repairedQueue.results.some((result) => !result.ok)) {
  throw new Error("A repaired 67-record Google Sheets queue could not be written in bulk.");
}

console.log("Google Sheets canonical, legacy, wallet-removal, and bulk payload checks passed.");

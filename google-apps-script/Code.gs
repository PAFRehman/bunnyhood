function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return jsonResponse_({
    ok: Boolean(SpreadsheetApp.getActiveSpreadsheet()),
    service: "bunny-hood-spin-sheet-v1"
  });
}

function safeCell_(value) {
  var text = String(value == null ? "" : value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function validUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function validDate_(value) {
  return !isNaN(Date.parse(String(value || "")));
}

function firstValue_(payload, names, fallback) {
  for (var index = 0; index < names.length; index += 1) {
    var value = payload[names[index]];
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

function normalizedUuid_(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizedUsername_(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function normalizedXId_(value) {
  return String(value || "").trim();
}

function normalizedDate_(value) {
  var parsed = new Date(String(value || ""));
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function nonNegativeInteger_(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  var parsed = Number(value);
  return isFinite(parsed) && Math.floor(parsed) === parsed && parsed >= 0 ? parsed : fallback;
}

function normalizedSpinUser_(payload) {
  var referralCode = String(firstValue_(payload, ["referralCode", "referral_code"], "") || "")
    .trim().replace(/^@+/, "").toLowerCase();
  if (referralCode && !/^[a-z0-9_]{3,24}$/.test(referralCode)) referralCode = "";
  var value = {
    userId: normalizedUuid_(firstValue_(payload, ["userId", "user_id", "id"], "")),
    xUserId: normalizedXId_(firstValue_(payload, ["xUserId", "x_user_id"], "")),
    xUsername: normalizedUsername_(firstValue_(payload, ["xUsername", "x_username", "username"], "")),
    xName: String(firstValue_(payload, ["xName", "x_name", "name"], "") || "").trim().slice(0, 100),
    spinsAvailable: nonNegativeInteger_(firstValue_(payload, ["spinsAvailable", "spins_available", "spins"], 0), 0),
    spinsUsed: nonNegativeInteger_(firstValue_(payload, ["spinsUsed", "spins_used"], 0), 0),
    points: nonNegativeInteger_(firstValue_(payload, ["points"], 0), 0),
    totalWins: nonNegativeInteger_(firstValue_(payload, ["totalWins", "total_wins"], 0), 0),
    referralCode: referralCode,
    referralCount: nonNegativeInteger_(firstValue_(payload, ["referralCount", "referral_count"], 0), 0),
    referralSpinsEarned: nonNegativeInteger_(firstValue_(payload, ["referralSpinsEarned", "referral_spins_earned"], 0), 0),
    updatedAt: normalizedDate_(firstValue_(payload, ["updatedAt", "updated_at"], ""))
  };
  return validSpinUser_(value) ? value : null;
}

function normalizedWallet_(value) {
  return String(value || "").trim().toLowerCase();
}

function sheetWithHeader_(name, header) {
  var workbook = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = workbook.getSheetByName(name);
  if (!sheet) sheet = workbook.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(header);
  else sheet.getRange(1, 1, 1, header.length).setValues([header]);
  return sheet;
}

function findRowById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var match = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(String(id))
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function validSpinUser_(payload) {
  return validUuid_(payload.userId)
    && /^[0-9]{1,30}$/.test(String(payload.xUserId || ""))
    && /^[A-Za-z0-9_]{1,15}$/.test(String(payload.xUsername || ""))
    && String(payload.xName || "").length <= 100
    && Number.isInteger(payload.spinsAvailable)
    && Number(payload.spinsAvailable) >= 0
    && Number.isInteger(payload.spinsUsed)
    && Number(payload.spinsUsed) >= 0
    && Number.isInteger(payload.points)
    && Number(payload.points) >= 0
    && Number.isInteger(payload.totalWins)
    && Number(payload.totalWins) >= 0
    && (!payload.referralCode || /^[a-z0-9_]{3,24}$/.test(String(payload.referralCode)))
    && Number.isInteger(payload.referralCount)
    && Number(payload.referralCount || 0) >= 0
    && Number.isInteger(payload.referralSpinsEarned)
    && Number(payload.referralSpinsEarned || 0) >= 0
    && validDate_(payload.updatedAt);
}

function handleSpinUser_(payload) {
  var normalized = normalizedSpinUser_(payload);
  if (!normalized) return { ok: false, code: "INVALID_SPIN_USER" };
  var sheet = sheetWithHeader_("Spin Users", [
    "User ID", "X User ID", "X Username", "X Name", "Spins Available",
    "Spins Used", "Points", "Total Wins", "Referral Code", "Successful Referrals",
    "Referral Spins Earned", "Updated At"
  ]);
  var values = [[
    safeCell_(normalized.userId), safeCell_(normalized.xUserId), safeCell_(normalized.xUsername),
    safeCell_(normalized.xName), normalized.spinsAvailable, normalized.spinsUsed,
    normalized.points, normalized.totalWins, safeCell_(normalized.referralCode),
    normalized.referralCount, normalized.referralSpinsEarned, safeCell_(normalized.updatedAt)
  ]];
  var row = findRowById_(sheet, normalized.userId);
  if (row) {
    var savedUpdatedAt = String(sheet.getRange(row, 12).getDisplayValue() || "");
    if (validDate_(savedUpdatedAt) && Date.parse(savedUpdatedAt) >= Date.parse(normalized.updatedAt)) {
      return { ok: true, duplicate: true, stale: true };
    }
    sheet.getRange(row, 1, 1, values[0].length).setValues(values);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, values[0].length).setValues(values);
  }
  return { ok: true, duplicate: Boolean(row) };
}

function validSpinWin_(payload) {
  var wallet = String(payload.wallet || "");
  return validUuid_(payload.winId)
    && validUuid_(payload.userId)
    && /^[0-9]{1,30}$/.test(String(payload.xUserId || ""))
    && /^[A-Za-z0-9_]{1,15}$/.test(String(payload.xUsername || ""))
    && ["GTD", "FCFS1", "FCFS2"].indexOf(String(payload.prizeType || "")) >= 0
    && validDate_(payload.wonAt)
    && (!wallet || /^0x[a-fA-F0-9]{40}$/.test(wallet))
    && (!payload.walletSubmittedAt || validDate_(payload.walletSubmittedAt));
}

function normalizedSpinWin_(payload) {
  var wallet = String(firstValue_(payload, ["wallet", "walletAddress", "wallet_address"], "") || "").trim();
  var walletSubmittedAt = String(firstValue_(payload, ["walletSubmittedAt", "wallet_submitted_at"], "") || "").trim();
  if (wallet && !validDate_(walletSubmittedAt)) walletSubmittedAt = new Date().toISOString();
  if (!wallet) walletSubmittedAt = "";
  var value = {
    winId: normalizedUuid_(firstValue_(payload, ["winId", "win_id", "id"], "")),
    userId: normalizedUuid_(firstValue_(payload, ["userId", "user_id"], "")),
    xUserId: normalizedXId_(firstValue_(payload, ["xUserId", "x_user_id"], "")),
    xUsername: normalizedUsername_(firstValue_(payload, ["xUsername", "x_username", "username"], "")),
    xName: String(firstValue_(payload, ["xName", "x_name", "name"], "") || "").trim().slice(0, 100),
    prizeType: String(firstValue_(payload, ["prizeType", "prize_type", "prize"], "") || "").trim().toUpperCase(),
    wonAt: normalizedDate_(firstValue_(payload, ["wonAt", "won_at"], "")),
    wallet: wallet,
    walletSubmittedAt: walletSubmittedAt,
    walletChangeAllowed: firstValue_(payload, ["walletChangeAllowed", "wallet_change_allowed"], false) === true
  };
  return validSpinWin_(value) ? value : null;
}

function handleSpinWin_(payload) {
  var normalized = normalizedSpinWin_(payload);
  if (!normalized) return { ok: false, code: "INVALID_SPIN_WIN" };
  var sheet = sheetWithHeader_("Spin Wins", [
    "Win ID", "User ID", "X User ID", "X Username", "X Name", "Prize",
    "Won At", "EVM Wallet", "Wallet Submitted At"
  ]);
  var row = findRowById_(sheet, normalized.winId);
  var values = [[
    safeCell_(normalized.winId), safeCell_(normalized.userId), safeCell_(normalized.xUserId),
    safeCell_(normalized.xUsername), safeCell_(normalized.xName), safeCell_(normalized.prizeType),
    safeCell_(normalized.wonAt), safeCell_(normalized.wallet), safeCell_(normalized.walletSubmittedAt)
  ]];
  if (row) sheet.getRange(row, 1, 1, values[0].length).setValues(values);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, values[0].length).setValues(values);
  return { ok: true, duplicate: Boolean(row) };
}

function validSpinReferral_(payload) {
  return validUuid_(payload.referralId)
    && validUuid_(payload.referrerUserId)
    && validUuid_(payload.referredUserId)
    && /^[0-9]{1,30}$/.test(String(payload.referrerXUserId || ""))
    && /^[0-9]{1,30}$/.test(String(payload.referredXUserId || ""))
    && /^[A-Za-z0-9_]{1,15}$/.test(String(payload.referrerUsername || ""))
    && /^[A-Za-z0-9_]{1,15}$/.test(String(payload.referredUsername || ""))
    && /^[a-z0-9_]{3,24}$/.test(String(payload.referralCode || ""))
    && Number(payload.awardedSpins) === 3
    && validDate_(payload.createdAt);
}

function normalizedSpinReferral_(payload) {
  var value = {
    referralId: normalizedUuid_(firstValue_(payload, ["referralId", "referral_id", "id"], "")),
    referrerUserId: normalizedUuid_(firstValue_(payload, ["referrerUserId", "referrer_user_id"], "")),
    referredUserId: normalizedUuid_(firstValue_(payload, ["referredUserId", "referred_user_id"], "")),
    referrerXUserId: normalizedXId_(firstValue_(payload, ["referrerXUserId", "referrer_x_user_id"], "")),
    referredXUserId: normalizedXId_(firstValue_(payload, ["referredXUserId", "referred_x_user_id"], "")),
    referrerUsername: normalizedUsername_(firstValue_(payload, ["referrerUsername", "referrer_username"], "")),
    referredUsername: normalizedUsername_(firstValue_(payload, ["referredUsername", "referred_username"], "")),
    referralCode: String(firstValue_(payload, ["referralCode", "referral_code"], "") || "").trim().replace(/^@+/, "").toLowerCase(),
    awardedSpins: nonNegativeInteger_(firstValue_(payload, ["awardedSpins", "awarded_spins"], 3), 3),
    createdAt: normalizedDate_(firstValue_(payload, ["createdAt", "created_at"], ""))
  };
  return validSpinReferral_(value) ? value : null;
}

function handleSpinReferral_(payload) {
  var normalized = normalizedSpinReferral_(payload);
  if (!normalized) return { ok: false, code: "INVALID_SPIN_REFERRAL" };
  var sheet = sheetWithHeader_("Spin Referrals", [
    "Referral ID", "Referrer User ID", "Referrer X User ID", "Referrer Username",
    "Referred User ID", "Referred X User ID", "Referred Username", "Referral Code",
    "Awarded Spins", "Created At"
  ]);
  var row = findRowById_(sheet, normalized.referralId);
  if (row) return { ok: true, duplicate: true };
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 10).setValues([[
    safeCell_(normalized.referralId), safeCell_(normalized.referrerUserId),
    safeCell_(normalized.referrerXUserId), safeCell_(normalized.referrerUsername),
    safeCell_(normalized.referredUserId), safeCell_(normalized.referredXUserId),
    safeCell_(normalized.referredUsername), safeCell_(normalized.referralCode),
    normalized.awardedSpins, safeCell_(normalized.createdAt)
  ]]);
  return { ok: true, duplicate: false };
}

function sheetState_(name, header) {
  var sheet = sheetWithHeader_(name, header);
  var rowCount = Math.max(0, sheet.getLastRow() - 1);
  var rows = rowCount ? sheet.getRange(2, 1, rowCount, header.length).getValues() : [];
  var indexById = {};
  for (var index = 0; index < rows.length; index += 1) {
    indexById["id:" + String(rows[index][0])] = index;
  }
  return {
    sheet: sheet,
    rows: rows,
    indexById: indexById,
    width: header.length,
    originalLength: rows.length,
    changedIndexes: {}
  };
}

function setSheetStateRow_(state, index, row) {
  state.rows[index] = row;
  state.changedIndexes[String(index)] = true;
}

function appendSheetStateRow_(state, row) {
  var index = state.rows.length;
  state.rows.push(row);
  state.changedIndexes[String(index)] = true;
  return index;
}

function saveSheetState_(state) {
  var changed = Object.keys(state.changedIndexes)
    .map(function (value) { return Number(value); })
    .filter(function (index) { return index < state.originalLength; })
    .sort(function (left, right) { return left - right; });
  var cursor = 0;
  while (cursor < changed.length) {
    var start = changed[cursor];
    var end = start;
    while (cursor + 1 < changed.length && changed[cursor + 1] === end + 1) {
      cursor += 1;
      end = changed[cursor];
    }
    state.sheet
      .getRange(start + 2, 1, end - start + 1, state.width)
      .setValues(state.rows.slice(start, end + 1));
    cursor += 1;
  }
  var appended = state.rows.slice(state.originalLength);
  if (appended.length) {
    state.sheet
      .getRange(state.originalLength + 2, 1, appended.length, state.width)
      .setValues(appended);
  }
}

function batchResult_(deliveryKey, result) {
  var response = { deliveryKey: deliveryKey, ok: Boolean(result && result.ok) };
  if (result && result.code) response.code = result.code;
  if (result && result.duplicate) response.duplicate = true;
  if (result && result.stale) response.stale = true;
  return response;
}

function handleSpinUserBatch_(items, results) {
  if (!items.length) return;
  var state = sheetState_("Spin Users", [
    "User ID", "X User ID", "X Username", "X Name", "Spins Available",
    "Spins Used", "Points", "Total Wins", "Referral Code", "Successful Referrals",
    "Referral Spins Earned", "Updated At"
  ]);
  for (var index = 0; index < items.length; index += 1) {
    var item = items[index];
    var value = item.value;
    var row = [
      safeCell_(value.userId), safeCell_(value.xUserId), safeCell_(value.xUsername),
      safeCell_(value.xName), value.spinsAvailable, value.spinsUsed, value.points,
      value.totalWins, safeCell_(value.referralCode), value.referralCount,
      value.referralSpinsEarned, safeCell_(value.updatedAt)
    ];
    var existingIndex = state.indexById["id:" + value.userId];
    if (existingIndex !== undefined) {
      var savedUpdatedAt = String(state.rows[existingIndex][11] || "");
      if (validDate_(savedUpdatedAt) && Date.parse(savedUpdatedAt) >= Date.parse(value.updatedAt)) {
        results[item.resultIndex] = batchResult_(item.deliveryKey, { ok: true, duplicate: true, stale: true });
        continue;
      }
      setSheetStateRow_(state, existingIndex, row);
      results[item.resultIndex] = batchResult_(item.deliveryKey, { ok: true, duplicate: true });
    } else {
      state.indexById["id:" + value.userId] = appendSheetStateRow_(state, row);
      results[item.resultIndex] = batchResult_(item.deliveryKey, { ok: true });
    }
  }
  saveSheetState_(state);
}

function handleSpinWinBatch_(items, results) {
  if (!items.length) return;
  var state = sheetState_("Spin Wins", [
    "Win ID", "User ID", "X User ID", "X Username", "X Name", "Prize",
    "Won At", "EVM Wallet", "Wallet Submitted At"
  ]);
  for (var index = 0; index < items.length; index += 1) {
    var item = items[index];
    var value = item.value;
    var row = [
      safeCell_(value.winId), safeCell_(value.userId), safeCell_(value.xUserId),
      safeCell_(value.xUsername), safeCell_(value.xName), safeCell_(value.prizeType),
      safeCell_(value.wonAt), safeCell_(value.wallet), safeCell_(value.walletSubmittedAt)
    ];
    var existingIndex = state.indexById["id:" + value.winId];
    if (existingIndex !== undefined) {
      setSheetStateRow_(state, existingIndex, row);
      results[item.resultIndex] = batchResult_(item.deliveryKey, { ok: true, duplicate: true });
    } else {
      state.indexById["id:" + value.winId] = appendSheetStateRow_(state, row);
      results[item.resultIndex] = batchResult_(item.deliveryKey, { ok: true });
    }
  }
  saveSheetState_(state);
}

function handleSpinReferralBatch_(items, results) {
  if (!items.length) return;
  var state = sheetState_("Spin Referrals", [
    "Referral ID", "Referrer User ID", "Referrer X User ID", "Referrer Username",
    "Referred User ID", "Referred X User ID", "Referred Username", "Referral Code",
    "Awarded Spins", "Created At"
  ]);
  for (var index = 0; index < items.length; index += 1) {
    var item = items[index];
    var value = item.value;
    var existingIndex = state.indexById["id:" + value.referralId];
    if (existingIndex !== undefined) {
      results[item.resultIndex] = batchResult_(item.deliveryKey, { ok: true, duplicate: true });
      continue;
    }
    state.indexById["id:" + value.referralId] = appendSheetStateRow_(state, [
      safeCell_(value.referralId), safeCell_(value.referrerUserId),
      safeCell_(value.referrerXUserId), safeCell_(value.referrerUsername),
      safeCell_(value.referredUserId), safeCell_(value.referredXUserId),
      safeCell_(value.referredUsername), safeCell_(value.referralCode),
      value.awardedSpins, safeCell_(value.createdAt)
    ]);
    results[item.resultIndex] = batchResult_(item.deliveryKey, { ok: true });
  }
  saveSheetState_(state);
}

function handleBatch_(events) {
  if (!Array.isArray(events) || !events.length || events.length > 100) {
    return { ok: false, code: "INVALID_BATCH" };
  }
  var results = new Array(events.length);
  var groups = { spin_user: [], spin_win: [], spin_referral: [] };
  var seenKeys = {};
  for (var index = 0; index < events.length; index += 1) {
    var event = events[index] || {};
    var deliveryKey = String(event.deliveryKey || "");
    var eventType = String(event.eventType || event.event_type || "");
    var eventPayload = event.payload && typeof event.payload === "object" ? event.payload : {};
    if (!/^[0-9]+:[0-9]+$/.test(deliveryKey) || seenKeys[deliveryKey]) {
      results[index] = batchResult_(deliveryKey, { ok: false, code: "INVALID_DELIVERY_KEY" });
      continue;
    }
    seenKeys[deliveryKey] = true;
    var normalized = eventType === "spin_user" ? normalizedSpinUser_(eventPayload)
      : eventType === "spin_win" ? normalizedSpinWin_(eventPayload)
      : eventType === "spin_referral" ? normalizedSpinReferral_(eventPayload)
      : null;
    if (!normalized) {
      var code = eventType === "spin_user" ? "INVALID_SPIN_USER"
        : eventType === "spin_win" ? "INVALID_SPIN_WIN"
        : eventType === "spin_referral" ? "INVALID_SPIN_REFERRAL"
        : "UNKNOWN_EVENT";
      results[index] = batchResult_(deliveryKey, { ok: false, code: code });
      continue;
    }
    groups[eventType].push({ deliveryKey: deliveryKey, resultIndex: index, value: normalized });
  }
  handleSpinUserBatch_(groups.spin_user, results);
  handleSpinWinBatch_(groups.spin_win, results);
  handleSpinReferralBatch_(groups.spin_referral, results);
  return { ok: true, results: results };
}

function doPost(e) {
  try {
    var rawBody = e && e.postData ? String(e.postData.contents || "") : "";
    if (!rawBody || rawBody.length > 262144) return jsonResponse_({ ok: false, code: "INVALID_REQUEST" });
    var payload = JSON.parse(rawBody);
    var expectedToken = PropertiesService.getScriptProperties().getProperty("BUNNY_HOOD_WEBHOOK_TOKEN");
    if (!expectedToken || String(payload.webhookToken || "") !== expectedToken) {
      return jsonResponse_({ ok: false, code: "UNAUTHORIZED" });
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, code: "BUSY_RETRY" });
    try {
      var eventType = String(payload.eventType || payload.event_type || "");
      if (payload.source === "bunny-hood-spin-v1" && eventType === "batch") {
        return jsonResponse_(handleBatch_(payload.events));
      }
      if (payload.source === "bunny-hood-spin-v1" && eventType === "spin_user") {
        return jsonResponse_(handleSpinUser_(payload));
      }
      if (payload.source === "bunny-hood-spin-v1" && eventType === "spin_win") {
        return jsonResponse_(handleSpinWin_(payload));
      }
      if (payload.source === "bunny-hood-spin-v1" && eventType === "spin_referral") {
        return jsonResponse_(handleSpinReferral_(payload));
      }
      return jsonResponse_({ ok: false, code: "UNKNOWN_EVENT" });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error("Bunny Hood Sheet webhook rejected a request.");
    return jsonResponse_({ ok: false, code: "REQUEST_REJECTED" });
  }
}

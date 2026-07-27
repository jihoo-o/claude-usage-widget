// Claude Usage Widget for Scriptable
// 1) Run this once inside the Scriptable app (not as a widget) to register your sessionKey.
//    Paste the sessionKey ONLY into the popup that appears — never store it elsewhere.
//    The org ID is auto-detected from your account, no need to edit this file.
// 2) Then add a Scriptable widget to your Home Screen and select this script.
// 3) If your session expires, just open the script directly in the app (not the
//    widget) and run it — an expired/invalid session is detected automatically
//    and you'll be prompted to paste a fresh sessionKey.

const KEYCHAIN_SESSION_KEY = "claude_session_key";
const KEYCHAIN_ORG_ID = "claude_org_id";

async function getSessionKey() {
  if (Keychain.contains(KEYCHAIN_SESSION_KEY)) {
    return Keychain.get(KEYCHAIN_SESSION_KEY);
  }
  if (config.runsInWidget) {
    return null;
  }
  let alert = new Alert();
  alert.title = "Claude 세션 키 등록";
  alert.message = "claude.ai 로그인 후 브라우저 개발자도구 > Cookies에서 'sessionKey' 값을 복사해 붙여넣으세요.";
  alert.addSecureTextField("sk-ant-sid...");
  alert.addAction("저장");
  alert.addCancelAction("취소");
  const idx = await alert.presentAlert();
  if (idx === -1) return null;
  const value = alert.textFieldValue(0);
  if (value) Keychain.set(KEYCHAIN_SESSION_KEY, value);
  return value;
}

function authHeaders(sessionKey) {
  return {
    "Cookie": `sessionKey=${sessionKey}`,
    "Content-Type": "application/json",
    "anthropic-client-platform": "web_claude_ai"
  };
}

async function getOrgId(sessionKey) {
  if (Keychain.contains(KEYCHAIN_ORG_ID)) {
    return Keychain.get(KEYCHAIN_ORG_ID);
  }
  if (config.runsInWidget) {
    return null;
  }
  const req = new Request("https://claude.ai/api/organizations");
  req.method = "GET";
  req.headers = authHeaders(sessionKey);
  const data = await req.loadJSON();
  if (req.response && req.response.statusCode >= 400) {
    const err = new Error(`조직 조회 실패 HTTP ${req.response.statusCode}`);
    err.status = req.response.statusCode;
    throw err;
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("계정에 연결된 조직을 찾을 수 없음");
  }
  const orgId = data[0].uuid || data[0].id;
  Keychain.set(KEYCHAIN_ORG_ID, orgId);
  return orgId;
}

async function fetchUsage(sessionKey, orgId) {
  const req = new Request(`https://claude.ai/api/organizations/${orgId}/usage`);
  req.method = "GET";
  req.headers = authHeaders(sessionKey);
  const json = await req.loadJSON();
  if (req.response && req.response.statusCode >= 400) {
    const err = new Error(`HTTP ${req.response.statusCode}`);
    err.status = req.response.statusCode;
    throw err;
  }
  return json;
}

function isAuthError(e) {
  return e && (e.status === 401 || e.status === 403);
}

async function promptForNewSessionKey() {
  let alert = new Alert();
  alert.title = "Claude 세션 키 만료됨";
  alert.message = "세션이 만료된 것 같습니다. claude.ai에 다시 로그인해 새 'sessionKey' 쿠키 값을 붙여넣으세요.";
  alert.addSecureTextField("sk-ant-sid...");
  alert.addAction("갱신");
  alert.addCancelAction("취소");
  const idx = await alert.presentAlert();
  if (idx === -1) return null;
  const value = alert.textFieldValue(0);
  if (value) Keychain.set(KEYCHAIN_SESSION_KEY, value);
  return value;
}

function formatResetTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function colorForPercent(pct) {
  if (pct === null || pct === undefined) return Color.gray();
  if (pct >= 80) return Color.red();
  if (pct >= 50) return new Color("#e0a800"); // amber
  return new Color("#3ddc84"); // green
}

function addUsageRow(w, label, pct, resetsAt) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const dot = row.addText("●");
  dot.font = Font.systemFont(12);
  dot.textColor = colorForPercent(pct);
  row.addSpacer(6);

  const text = row.addText(`${label} ${pct ?? "-"}%`);
  text.font = Font.mediumSystemFont(13);
  text.textColor = Color.white();

  w.addSpacer(2);
  if (resetsAt) {
    const reset = w.addText(`  ${formatResetTime(resetsAt)} 초기화`);
    reset.font = Font.systemFont(9);
    reset.textColor = Color.gray();
  }
  w.addSpacer(8);
}

function buildErrorWidget(message) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#1a1a1a");
  const t = w.addText(message);
  t.textColor = Color.red();
  t.font = Font.systemFont(12);
  return w;
}

function buildUsageWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#1a1a1a");
  w.setPadding(12, 14, 12, 14);

  const title = w.addText("Claude Usage");
  title.font = Font.boldSystemFont(14);
  title.textColor = Color.white();
  w.addSpacer(10);

  const fiveHour = data.five_hour;
  const sevenDay = data.seven_day;

  if (fiveHour) addUsageRow(w, "세션", fiveHour.utilization, fiveHour.resets_at);
  if (sevenDay) addUsageRow(w, "주간", sevenDay.utilization, sevenDay.resets_at);

  const extra = data.extra_usage;
  if (extra && extra.is_enabled) {
    const used = extra.used_credits ?? 0;
    const limit = extra.monthly_limit ?? 0;
    const extraText = w.addText(`추가 크레딧: $${used.toFixed(2)} / $${limit}`);
    extraText.font = Font.systemFont(10);
    extraText.textColor = Color.gray();
  }

  return w;
}

async function run() {
  const sessionKey = await getSessionKey();

  if (!sessionKey) {
    const w = buildErrorWidget("Scriptable 앱에서 먼저 실행해\n세션 키를 등록하세요");
    if (config.runsInWidget) {
      Script.setWidget(w);
    } else {
      w.presentSmall();
    }
    return;
  }

  try {
    const orgId = await getOrgId(sessionKey);
    if (!orgId) {
      const w = buildErrorWidget("Scriptable 앱에서 먼저 실행해\n조직 정보를 등록하세요");
      if (config.runsInWidget) {
        Script.setWidget(w);
      } else {
        w.presentSmall();
      }
      return;
    }
    const data = await fetchUsage(sessionKey, orgId);
    const w = buildUsageWidget(data);
    if (config.runsInWidget) {
      Script.setWidget(w);
    } else {
      w.presentSmall();
    }
  } catch (e) {
    if (isAuthError(e) && !config.runsInWidget) {
      // Interactive prompts only work when run inside the app, not as a widget.
      const newKey = await promptForNewSessionKey();
      if (newKey) {
        try {
          const orgId = await getOrgId(newKey);
          const data = await fetchUsage(newKey, orgId);
          const w = buildUsageWidget(data);
          w.presentSmall();
          return;
        } catch (e2) {
          const w = buildErrorWidget("갱신 후에도 실패: " + e2.message);
          w.presentSmall();
          return;
        }
      }
    }

    const message = isAuthError(e)
      ? "세션 만료됨\nScriptable 앱에서 직접 실행해 갱신하세요"
      : "요청 실패: " + e.message;
    const w = buildErrorWidget(message);
    if (config.runsInWidget) {
      Script.setWidget(w);
    } else {
      w.presentSmall();
    }
  }
}

await run();
Script.complete();

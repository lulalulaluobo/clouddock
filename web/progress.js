(() => {
  if (localStorage.getItem("theme") === "dark") document.documentElement.dataset.theme = "dark";
  const message = document.querySelector(".clouddock-progress-message"), frame = document.getElementById("ariang-frame");
  const tabs = [...document.querySelectorAll("[data-view]")];
  function syncTabs() {
    const path = frame.contentWindow.location.hash;
    for (const tab of tabs) {
      if (path === "#!/" + tab.dataset.view) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
    }
  }
  for (const tab of tabs) tab.addEventListener("click", () => { frame.contentWindow.location.hash = "!/" + tab.dataset.view; syncTabs(); });
  document.getElementById("transfer-records").addEventListener("click", () => window.CloudDock.showRecords());
  document.getElementById("baidu-progress").addEventListener("click", () => window.CloudDock.showRecords("baidu"));
  function authenticationError() {
    message.hidden = false; message.replaceChildren(document.createTextNode("登录已失效或当前账号无下载管理权限，请返回搜索页重新登录。"));
    frame.hidden = true; frame.removeAttribute("src");
    for (const tab of tabs) tab.disabled = true;
  }
  window.addEventListener("message", event => { if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === "clouddock-auth-required") authenticationError(); });
  async function load() {
    const token = localStorage.getItem("token");
    if (!token) { authenticationError(); return; }
    try {
      const response = await fetch("/api/clouddock/health", { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
      if ([401, 403].includes(response.status)) { authenticationError(); return; }
      if (!response.ok) throw new Error();
      frame.addEventListener("load", () => { message.hidden = true; for (const tab of tabs) tab.disabled = false; frame.contentWindow.addEventListener("hashchange", syncTabs); syncTabs(); }, { once: true });
      frame.src = "./ariang/#!/downloading"; frame.hidden = false;
    } catch {
      message.textContent = "暂时无法连接 CloudDock。";
      const retry = document.createElement("button"); retry.textContent = "重新连接"; retry.type = "button"; retry.addEventListener("click", load); message.append(retry);
    }
  }
  void load();
})();

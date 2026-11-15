/* CloudDock extension for the installed v0.8.3 UI. The original resource,
 * channel management and cloud folder components remain the UI authority. */
(() => {
  const apiBase = "/api/clouddock";
  const state = { cloudType: "", enabled: true, target: null, roots: [], rootId: "media", path: "", expanded: false, loading: false, error: "", folders: [], generation: 0, intent: "", signature: "" };
  let dialog, directoryDialog, createDialog, createParent, recordTimer, healthTimer, recordProvider;
  let healthPending = false;
  async function request(endpoint, body) {
    const control = new AbortController(), timeout = setTimeout(() => control.abort(), 35000);
    try {
      const response = await fetch(apiBase + endpoint, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (localStorage.getItem("token") || "") }, body: body === undefined ? undefined : JSON.stringify(body), signal: control.signal });
      const value = await response.json();
      if (!response.ok || !value.success) throw new Error(value.message || "请求失败，请稍后重试");
      return value.data;
    } catch (error) { if (error.name === "AbortError") throw new Error("请求结果未确认，请查看下载记录后再重试"); throw error; }
    finally { clearTimeout(timeout); }
  }
  function element(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) { if (key === "text") node.textContent = value; else if (key === "class") node.className = value; else node.setAttribute(key, value); }
    for (const child of children) node.append(child);
    return node;
  }
  function button(text, action, className = "") { const node = element("button", { type: "button", text, class: className }); node.addEventListener("click", action); return node; }
  function notify(text) {
    document.querySelector(".clouddock-notice")?.remove();
    const notice = element("div", { class: "clouddock-notice", role: "status", text }); document.body.append(notice); setTimeout(() => notice.remove(), 5500);
  }
  const label = () => state.roots.find(row => row.id === state.rootId)?.label || "飞牛影视";
  function panel() {
    const host = element("section", { class: "clouddock-target", "aria-label": "飞牛本地保存路径" });
    const toggle = element("input", { type: "checkbox", "aria-label": "同时下载到飞牛" }); toggle.checked = state.enabled;
    const row = element("label", { class: "clouddock-switch" }, [toggle, element("span", { text: "下载到飞牛" })]);
    toggle.addEventListener("change", () => { state.enabled = toggle.checked; renderPanels(); });
    const current = button("", showDirectoryPicker, "clouddock-current");
    host.append(element("div", { class: "clouddock-target-tools" }, [row, current]));
    host.append(element("p", { class: "clouddock-error", role: "alert" }));
    host.append(element("div", { class: "clouddock-browser" }));
    return host;
  }
  function renderPanels() {
    document.querySelectorAll(".clouddock-create-trigger").forEach(node => { node.disabled = state.loading || !state.target || !state.enabled; });
    for (const host of document.querySelectorAll(".clouddock-target")) {
      host.querySelector("input").checked = state.enabled;
      const current = host.querySelector(".clouddock-current"), inlineBrowser = host.querySelector(".clouddock-browser"), browser = directoryDialog?.querySelector(".clouddock-browser") || inlineBrowser, error = host.querySelector(".clouddock-error");
      inlineBrowser.hidden = true;
      current.hidden = !state.enabled; browser.hidden = !state.enabled || !state.expanded; error.hidden = !state.enabled || !state.error;
      const path = `${label()}${state.path ? " / " + state.path : "（根目录）"}`;
      current.replaceChildren(element("strong", { text: state.loading ? "读取中…" : path }), element("span", { text: "更改 ›" }));
      current.title = path;
      current.setAttribute("aria-label", "更改飞牛保存路径，当前：" + path);
      current.disabled = state.loading;
      error.replaceChildren();
      if (state.error) error.append(element("span", { text: state.error }), button("重试", initialize));
      browser.replaceChildren();
      if (!state.expanded) continue;
      if (state.roots.length > 1) {
        const select = element("select", { "aria-label": "飞牛存储位置" });
        for (const root of state.roots) { const option = element("option", { value: root.id, text: root.label }); option.selected = root.id === state.rootId; select.append(option); }
        select.addEventListener("change", () => { state.rootId = select.value; void browse(""); }); browser.append(select);
      }
      const nav = element("nav", { "aria-label": "飞牛目录" });
      nav.append(button(label(), () => browse("")));
      const parts = state.path.split("/").filter(Boolean);
      parts.forEach((part, index) => nav.append(button(part, () => browse(parts.slice(0, index + 1).join("/")))));
      browser.append(nav);
      const list = element("div", { class: "clouddock-folders" });
      if (state.loading) list.append(element("p", { text: "正在读取目录…" }));
      else if (!state.folders.length) list.append(element("p", { text: "当前目录没有子文件夹" }));
      else for (const folder of state.folders) list.append(button("📁 " + folder.name + " ›", () => browse(folder.relativePath)));
      browser.append(list);
      const done = button("使用当前目录", () => { directoryDialog?.close(); state.expanded = false; renderPanels(); }, "clouddock-use-directory"); done.disabled = !state.target || state.loading; browser.append(done);
    }
  }
  function showDirectoryPicker() {
    if (!directoryDialog) {
      directoryDialog = element("dialog", { class: "clouddock-records clouddock-directory-dialog", "aria-label": "选择飞牛本地目录" });
      directoryDialog.append(element("header", {}, [element("h2", { text: "飞牛保存路径" }), button("飞牛新建", showCreateDirectory, "clouddock-create-trigger"), button("返回", () => directoryDialog.close())]), element("div", { class: "clouddock-browser" }));
      directoryDialog.addEventListener("close", () => { state.expanded = false; renderPanels(); });
      document.body.append(directoryDialog);
    }
    state.expanded = true; renderPanels(); directoryDialog.showModal();
  }
  function showCreateDirectory() {
    if (!state.target || state.loading) { notify("请先选择可用的飞牛目录"); return; }
    createParent = { ...state.target };
    if (!createDialog) {
      createDialog = element("dialog", { class: "clouddock-records clouddock-create-dialog", "aria-label": "飞牛新建文件夹" });
      const form = element("form"), input = element("input", { id: "clouddock-new-directory-name", name: "name", type: "text", maxlength: "80", required: "", autocomplete: "off", placeholder: "输入飞牛文件夹名称" });
      const submit = element("button", { type: "submit", text: "创建飞牛文件夹" });
      form.append(element("p", { class: "clouddock-create-parent" }), element("label", { for: input.id, text: "文件夹名称" }), input, element("p", { class: "clouddock-create-error clouddock-error", role: "alert" }), submit);
      form.addEventListener("submit", async event => {
        event.preventDefault(); if (submit.disabled) return;
        const error = form.querySelector(".clouddock-create-error"); error.textContent = ""; submit.disabled = true;
        try { const result = await request("/directories", { target: { ...createParent }, name: input.value }); await browse(result.relativePath); createDialog.close(); notify("飞牛文件夹已创建并选中"); }
        catch (failure) { error.textContent = failure.message || "创建失败，请重试"; }
        finally { submit.disabled = false; }
      });
      createDialog.append(element("header", {}, [element("h2", { text: "飞牛新建文件夹" }), button("取消", () => createDialog.close())]), form); document.body.append(createDialog);
    }
    createDialog.querySelector("input").value = "";
    createDialog.querySelector(".clouddock-create-error").textContent = "";
    createDialog.querySelector(".clouddock-create-parent").textContent = "创建在：" + label() + (createParent.relativePath ? " / " + createParent.relativePath : "（根目录）");
    createDialog.showModal(); createDialog.querySelector("input").focus();
  }
  async function browse(relativePath) {
    if (!state.rootId) return;
    const generation = ++state.generation; state.loading = true; state.error = ""; state.target = null; renderPanels();
    try {
      const value = await request("/directories?" + new URLSearchParams({ rootId: state.rootId, path: relativePath }));
      if (generation !== state.generation) return;
      state.path = value.relativePath; state.folders = value.items; state.target = { rootId: state.rootId, relativePath: value.relativePath };
      localStorage.setItem("clouddock_download_target", JSON.stringify(state.target));
    } catch (error) { if (generation === state.generation) state.error = error.message; }
    finally { if (generation === state.generation) { state.loading = false; renderPanels(); } }
  }
  async function initialize() {
    if (state.loading) return;
    state.loading = true; state.error = ""; state.target = null; renderPanels();
    try {
      state.roots = await request("/roots");
      let previous = {}; try { previous = JSON.parse(localStorage.getItem("clouddock_download_target") || "{}"); } catch {}
      state.rootId = state.roots.find(row => row.id === previous.rootId)?.id || state.roots[0]?.id || "";
      if (!state.rootId) throw new Error("尚未配置飞牛存储位置");
      state.loading = false;
      await browse(previous.relativePath || "");
    } catch (error) { state.loading = false; state.error = error.message; renderPanels(); }
  }
  async function checkAria() {
    const host = document.querySelector(".clouddock-connection");
    if (!host || healthPending) return;
    healthPending = true;
    const status = host.querySelector("[role=status]"), detail = host.querySelector(".clouddock-connection-detail"), retry = host.querySelector("button");
    retry.disabled = true; host.setAttribute("aria-busy", "true");
    status.textContent = "检测中…"; host.dataset.connection = "checking";
    try {
      const result = await request("/health"), aria = result.aria2;
      host.dataset.connection = aria?.connected ? "connected" : "disconnected";
      status.textContent = aria?.connected ? "已连接" + (aria.version ? " · v" + aria.version : "") : "未连接";
      detail.textContent = aria?.connected ? "最近检测 " + new Date().toLocaleTimeString("zh-CN", { hour12: false }) : (aria?.message || "无法连接下载服务，请检查 aria2 是否运行后重新检测");
    } catch (error) {
      host.dataset.connection = "disconnected"; status.textContent = "检测失败"; detail.textContent = error.message;
    } finally { healthPending = false; retry.disabled = false; host.removeAttribute("aria-busy"); }
  }
  function attachConnection() {
    const settings = document.querySelector(".setting,.settings-page");
    if (!settings) { clearInterval(healthTimer); healthTimer = undefined; return; }
    if (settings.querySelector(".clouddock-connection")) return;
    const host = element("section", { class: "clouddock-connection", "aria-label": "aria2 连接状态" });
    host.append(element("div", { class: "clouddock-connection-main" }, [element("h2", { text: "aria2 下载服务" }), element("span", { role: "status", "aria-live": "polite", text: "检测中…" }), element("p", { class: "clouddock-connection-detail" })]), button("重新检测", checkAria));
    const hero = settings.querySelector(".setting__hero,.settings-hero");
    if (hero) hero.after(host); else settings.prepend(host);
    const baidu = element("section", { class: "clouddock-connection clouddock-baidu-connection", "aria-label": "飞牛百度网盘连接" });
    const status = element("span", { role: "status", "aria-live": "polite", text: "检测中…" });
    const detail = element("p", { class: "clouddock-connection-detail" });
    const form = element("form", { class: "clouddock-pair-form" });
    const connect = element("button", { type: "submit", text: "获取飞牛百度网盘授权" });
    const check = async () => {
      status.textContent = "检测中…";
      try { const value = await request("/baidu/health"); baidu.dataset.connection = value.connected ? "connected" : "disconnected"; status.textContent = value.connected ? "已连接 · " + (value.nasMember ? "NAS 会员有效" : "未检测到 NAS 会员") : "未连接"; detail.textContent = value.message; }
      catch (error) { status.textContent = "检测失败"; detail.textContent = error.message; }
    };
    form.append(connect);
    form.addEventListener("submit", async event => { event.preventDefault(); if (connect.disabled) return; connect.disabled = true; try { await request("/baidu/authorize", {}); await check(); } catch (error) { detail.textContent = error.message; } finally { connect.disabled = false; } });
    baidu.append(element("div", { class: "clouddock-connection-main" }, [element("h2", { text: "飞牛百度网盘" }), status, detail, element("p", { text: "先在飞牛官方百度网盘登录，再点击获取授权。无需填写 Cookie 或配对码。" }), form]), button("重新检测", check));
    host.after(baidu); void check();
    void checkAria(); clearInterval(healthTimer);
    healthTimer = setInterval(() => { if (!document.hidden) void checkAria(); }, 30000);
  }
  function attach() {
    attachConnection();
    if (["quark", "baiduPan"].includes(state.cloudType)) {
      for (const node of document.querySelectorAll(".save-dialog button,.save-popup button")) {
        if (node.textContent.trim() !== "新建文件夹") continue;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let text;
        const drive = state.cloudType === "baiduPan" ? "百度" : "夸克";
        while ((text = walker.nextNode())) if (text.nodeValue.trim() === "新建文件夹") text.nodeValue = text.nodeValue.replace("新建文件夹", drive + "新建");
        node.setAttribute("aria-label", "在当前" + drive + "目录新建文件夹");
      }
    }
    const folders = document.querySelectorAll(".save-dialog .folder-select, .save-popup .folder-select");
    for (const host of folders) {
      if (!["quark", "baiduPan"].includes(state.cloudType) || host.querySelector(".clouddock-target") || !host.getClientRects().length) continue;
      host.closest(".save-popup,.save-dialog")?.classList.add("clouddock-save");
      host.classList.add("clouddock-folder-host"); host.append(panel()); renderPanels();
      if (!state.roots.length && !state.loading) void initialize();
    }
    if (!document.getElementById("clouddock-records-entry")) {
      const header = document.querySelector(".pc-resources__header .header__right") || document.querySelector('[aria-label="资源列表工具栏"]');
      if (header) { const entry = button("下载进度", () => { location.href = "/clouddock/progress.html"; }, "clouddock-records-entry"); entry.id = "clouddock-records-entry"; header.append(entry); }
    }
  }
  function status(value) { return ({ queued: "等待执行", running: "转存处理中", downloading: "下载中", completed: "已完成", paused: "已暂停", failed: "需处理", pending: "准备提交", waiting: "等待下载", active: "下载中", complete: "已完成", error: "失败", removed: "已移除" })[value] || value; }
  async function refreshRecords() {
    if (!dialog?.open) return;
    const list = dialog.querySelector(".clouddock-job-list");
    try {
      const jobs = await request(recordProvider === "baidu" ? "/baidu/jobs" : "/jobs"); list.replaceChildren();
      if (!jobs.length) list.append(element("p", { class: "clouddock-empty", text: "还没有转存下载记录" }));
      for (const job of jobs) {
        const article = element("article");
        article.append(element("div", { class: "clouddock-job-heading" }, [element("strong", { text: job.title }), element("span", { text: status(job.state) })]));
        article.append(element("p", { text: job.download === false ? "仅转存到百度网盘" : "飞牛目录：" + (job.target.relativePath || "根目录") }));
        if (job.error) article.append(element("p", { class: "clouddock-error", text: job.error }));
        const progress = element("progress"); progress.max = Math.max(1, job.files.reduce((sum, file) => sum + file.total, 0)); progress.value = job.files.reduce((sum, file) => sum + file.completed, 0); if (job.download !== false) article.append(progress);
        const details = element("details", {}, [element("summary", { text: `文件明细（${job.files.length}）` })]);
        for (const file of job.files) details.append(element("p", { text: `${file.path} · ${status(file.state)}${file.total ? " · " + Math.round(file.completed / file.total * 100) + "%" : ""}${file.speed ? " · " + (file.speed / 1e6).toFixed(1) + " MB/s" : ""}${file.error ? " · " + file.error : ""}` }));
        article.append(details);
        const operations = element("div", { class: "clouddock-job-actions" });
        const action = job.state === "downloading" ? ["pause", "暂停"] : job.state === "paused" ? ["resume", "继续"] : job.state === "failed" ? ["retry", "失败重试"] : null;
        if (action && job.provider !== "baidu") operations.append(button(action[1], async event => { const target = event.currentTarget; target.disabled = true; try { await request(`/jobs/${encodeURIComponent(job.id)}/${action[0]}`, {}); await refreshRecords(); } catch (error) { notify(error.message); target.disabled = false; } }));
        if (job.provider === "baidu" && job.download && job.state !== "completed") operations.append(element("p", { text: "暂停、继续和失败恢复请在飞牛官方百度网盘操作。" }));
        article.append(operations); list.append(article);
      }
    } catch (error) { list.replaceChildren(element("p", { role: "alert", text: error.message })); }
  }
  function showRecords(provider = "quark") {
    recordProvider = provider;
    if (!dialog) {
      dialog = element("dialog", { class: "clouddock-records", "aria-label": "转存记录" });
      const header = element("header", {}, [element("h2", { text: "转存记录" }), button("关闭", () => dialog.close())]);
      dialog.append(header, element("div", { class: "clouddock-job-list" })); document.body.append(dialog);
      dialog.addEventListener("close", () => { clearInterval(recordTimer); });
    }
    dialog.querySelector("h2").textContent = provider === "baidu" ? "百度下载进度" : "夸克转存记录";
    dialog.showModal(); void refreshRecords(); clearInterval(recordTimer); recordTimer = setInterval(() => { if (!document.hidden) void refreshRecords(); }, 5000);
  }
  window.CloudDock = {
    version: "0.1.0-nas.4",
    showRecords,
    askBaiduFolderName() {
      return new Promise(resolve => {
        const picker = element("dialog", { class: "clouddock-records clouddock-create-dialog", "aria-label": "百度新建文件夹" });
        const input = element("input", { type: "text", required: "", maxlength: "80", "aria-label": "百度文件夹名称", placeholder: "输入百度文件夹名称" }), form = element("form");
        form.append(input, element("button", { type: "submit", text: "创建百度文件夹" }));
        form.addEventListener("submit", event => { event.preventDefault(); if (input.value.trim()) picker.close(input.value.trim()); });
        picker.append(element("header", {}, [element("h2", { text: "百度新建文件夹" }), button("取消", () => picker.close())]), form);
        picker.addEventListener("close", () => { resolve(picker.returnValue || null); picker.remove(); }, { once: true });
        document.body.append(picker); picker.showModal(); input.focus();
      });
    },
    async quarkShare(values) { return { code: 0, data: await request('/quark/share', values) }; },
    baiduApi: {
      async getShareInfo(values) { return { code: 0, data: await request("/baidu/share", values) }; },
      async getShareList(values) { return { code: 0, data: await request("/baidu/share", values) }; },
      async getFolderList(parentCid = "/") { return { code: 0, data: await request("/baidu/folders?" + new URLSearchParams({ parentCid })) }; },
      async createFolder(parentFid, folderName) { return { code: 0, data: await request("/baidu/create-folder", { parentFid, folderName }) }; },
    },
    open(cloudType) { state.generation++; state.cloudType = cloudType || ""; state.enabled = true; state.target = null; state.roots = []; state.path = ""; state.expanded = false; state.loading = false; state.error = ""; state.intent = ""; state.signature = ""; document.querySelectorAll(".clouddock-target").forEach(node => node.remove()); setTimeout(attach, 0); },
    setContext(cloudType) { state.cloudType = cloudType || ""; setTimeout(attach, 0); },
    enabled() { return state.enabled; },
    async submit({ resource, store, folderId }) {
      try {
        if (state.cloudType === "baiduPan") {
          if (state.enabled && (!state.target || state.loading || state.error)) throw new Error("请先选择可用的飞牛保存路径");
          const selected = store.resourceSelect.filter(row => row.isChecked);
          const body = { shareCode: store.shareInfo.shareCode, passcode: store.shareInfo.receiveCode || "", parentId: store.resourceSelectPath.at(-1)?.fileId || "/", folderId, selectedIds: selected.map(row => String(row.fileIdToken)), title: resource.title, target: state.target, download: state.enabled };
          const signature = JSON.stringify(body);
          if (!state.intent || signature !== state.signature) { state.intent = globalThis.crypto?.randomUUID?.() || `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`; state.signature = signature; }
          await request("/baidu/jobs", { ...body, intent: state.intent }); notify(state.enabled ? "已提交，可在下载进度中的百度下载查看" : "已提交百度转存，可在百度下载记录查看结果"); return true;
        }
        if (!state.target || state.loading || state.error) throw new Error("请先选择可用的飞牛保存路径");
        const link = store.currentCloudLink?.link || "", shareCode = link.match(/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/)?.[1];
        if (!shareCode) throw new Error("无法确认当前夸克分享，请重新打开资源");
        const selected = store.resourceSelect.filter(row => row.isChecked), ids = new Set(selected.map(row => row.fileId));
        const body = { shareCode, parentId: String(store.resourceSelectPath.at(-1)?.fileId || "0"), folderId: String(folderId), selectedIds: [...ids], title: resource.title, target: { ...state.target }, shareToken: store.shareInfo.stoken || "", passcode: link.match(/(?:pwd=|提取码[：:\s]*)([a-zA-Z0-9]+)/)?.[1] || "", renames: Object.values(store.renameDraftMap || {}).filter(row => ids.has(row.sourceFileId) && row.targetName?.trim() && row.targetName.trim() !== row.sourceFileName).map(row => ({ sourceFileId: row.sourceFileId, targetName: row.targetName.trim() })) };
        const signature = JSON.stringify(body);
        if (!state.intent || signature !== state.signature) { state.intent = globalThis.crypto?.randomUUID?.() || `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`; state.signature = signature; }
        await request("/jobs", { ...body, intent: state.intent }); notify("已提交转存并下载，可点击下载进度查看"); return true;
      } catch (error) { notify(error.message || "提交失败，请稍后重试"); return false; }
    },
  };
  const start = () => {
    let frame = 0;
    new MutationObserver(records => {
      // Image/status updates in resource cards do not mount extension controls.
      if (records.every(record => record.target instanceof Element && record.target.closest(".resource-card,.clouddock-target,.clouddock-connection,.clouddock-job-list"))) return;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; attach(); });
    }).observe(document.body, { childList: true, subtree: true });
    attach();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();

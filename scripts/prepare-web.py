"""Generate narrow, version-checked additions to the NAS v0.8.3 web bundle."""
from pathlib import Path
import hashlib
import json
import re
import shutil

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "upstream/nas-v0.8.3/html"
OUTPUT = ROOT / "build/web"
FLOW = "assets/useCloudSaveFlow-BG6GOU9O.js"


def once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError("NAS 版本或接入点不匹配，停止生成：" + before[:60])
    return text.replace(before, after, 1)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def baidu_folders(script, mobile=False):
    script = once(script, 'pan115:"0",quark:"0",tianyi:"",pan123:"0"', 'baiduPan:"/",pan115:"0",quark:"0",tianyi:"",pan123:"0"')
    if mobile:
        script = once(script, 'w={pan115:Zt,quark:Qe,tianyi:Qt,pan123:en}', 'w={baiduPan:globalThis.CloudDock.baiduApi,pan115:Zt,quark:Qe,tianyi:Qt,pan123:en}')
        script = once(script, 'if(o.cloudType!=="quark"){Y({type:"warning",message:"当前仅支持夸克网盘新建文件夹"});return}', 'if(!["quark","baiduPan"].includes(o.cloudType))return;')
        script = once(script, 'await Qe.createFolder(f,g)', 'await(o.cloudType==="baiduPan"?globalThis.CloudDock.baiduApi:Qe).createFolder(f,g)')
        script = once(script, 'if(C.currentCloudLink.cloudType!=="quark"){Y({type:"warning",message:"当前仅支持夸克网盘新建文件夹"});return}', 'if(!["quark","baiduPan"].includes(C.currentCloudLink.cloudType))return;')
        script = once(script, 'p(I)===2&&p(C).currentCloudLink.cloudType==="quark"?', 'p(I)===2&&["quark","baiduPan"].includes(p(C).currentCloudLink.cloudType)?')
    else:
        script = once(script, 'q={pan115:At,quark:Oe,tianyi:zt,pan123:qt}', 'q={baiduPan:globalThis.CloudDock.baiduApi,pan115:At,quark:Oe,tianyi:zt,pan123:qt}')
        script = once(script, 'if(h.cloudType!=="quark"){ce.warning("当前仅支持夸克网盘新建文件夹");return}', 'if(!["quark","baiduPan"].includes(h.cloudType))return;')
        script = once(script, 'await Oe.createFolder(o,L)', 'await(h.cloudType==="baiduPan"?globalThis.CloudDock.baiduApi:Oe).createFolder(o,L)')
        script = once(script, 'S?(Q.value=S.cid,W.value=S.name):ce.warning', 'S?(h.cloudType==="baiduPan"?await D(S):(Q.value=S.cid,W.value=S.name)):ce.warning')
        script = once(script, 'if(M.currentCloudLink.cloudType!=="quark"){ce.warning("当前仅支持夸克网盘新建文件夹");return}', 'if(M.currentCloudLink.cloudType==="baiduPan"){const name=await globalThis.CloudDock.askBaiduFolderName();if(name)await f?.createNewFolder(name);return}if(M.currentCloudLink.cloudType!=="quark")return;')
        script = once(script, 'n(b)===2&&n(C).currentCloudLink.cloudType==="quark"?', 'n(b)===2&&["quark","baiduPan"].includes(n(C).currentCloudLink.cloudType)?')
    return script


def main():
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SOURCE, OUTPUT, dirs_exist_ok=True)
    flow = (SOURCE / FLOW).read_text()
    flow = once(flow, "e.currentCloudLink=o,await e.getResourceListAndSelect(a,o)", "e.currentCloudLink=o,globalThis.CloudDock?.open(o.cloudType),await e.getResourceListAndSelect(a,o)")
    flow = once(flow, "R=a=>{c.value=a}", "R=a=>{c.value=a;globalThis.CloudDock?.setContext(e.currentCloudLink?.cloudType)}")
    flow = once(flow,
                "f=async()=>!r.value||!c.value?!1:(await e.saveResource(r.value,c.value)).success",
                'f=async()=>{if(!r.value||!c.value)return!1;if(e.currentCloudLink?.cloudType==="baiduPan"||e.currentCloudLink?.cloudType==="quark"&&globalThis.CloudDock?.enabled())return globalThis.CloudDock.submit({resource:r.value,store:e,folderId:c.value});return(await e.saveResource(r.value,c.value)).success}')
    flow = once(flow, "runPluginWithOptionalSave:async(a,s,o={})=>{await S(", 'runPluginWithOptionalSave:async(a,s,o={})=>{if(s&&(e.currentCloudLink?.cloudType==="baiduPan"||e.currentCloudLink?.cloudType==="quark"&&globalThis.CloudDock?.enabled())){t.onWarning("请使用保存按钮提交本次转存下载");return}await S(')
    flow_file = "assets/useCloudSaveFlow-clouddock-" + digest(flow.encode())[:12] + ".js"
    (OUTPUT / flow_file).write_text(flow)
    resource_source = "assets/resource-CodzvacV.js"
    resource = (SOURCE / resource_source).read_text()
    driver = '''{name:"百度网盘",type:"baiduPan",regex:/pan\\.baidu\\.com\\/s\\/(1[A-Za-z0-9_-]+)/,api:{getShareInfo:e=>globalThis.CloudDock.baiduApi.getShareInfo(e),getShareList:e=>globalThis.CloudDock.baiduApi.getShareList(e)},parseShareCode:(e,t)=>({shareCode:e.match(t)?.[1],receiveCode:e.match(/(?:pwd=|提取码[：:\\s]*)([A-Za-z0-9]+)/)?.[1]||""}),capabilities:{postSaveRename:false}},'''
    resource = once(resource, 'v=[{name:"115网盘"', 'v=[' + driver + '{name:"115网盘"')
    # Cached results from before this driver existed must also expose Baidu save.
    resource = once(resource, 'getValidSupportSaveLinks(e){if(!w())', 'getValidSupportSaveLinks(e){e={...e,supportSaveLinks:He(e.cloudLinks||[])};if(!w())')
    resource_file = "assets/resource-clouddock-" + digest(resource.encode())[:12] + ".js"
    (OUTPUT / resource_file).write_text(resource)
    desktop_source = "assets/ResourceList-C7bpI1Nl.js"
    desktop = baidu_folders((SOURCE / desktop_source).read_text())
    desktop_file = "assets/ResourceList-desktop-clouddock-" + digest(desktop.encode())[:12] + ".js"
    (OUTPUT / desktop_file).write_text(desktop)
    # Preserve originals; map only checked, generated copies of the installed UI.
    visibility = (ROOT / "web/visible-resources.mjs").read_bytes()
    visibility_file = "assets/clouddock-visible-" + digest(visibility)[:12] + ".js"
    (OUTPUT / visibility_file).write_bytes(visibility)
    mobile_source = "assets/ResourceList-p18e8BOQ.js"
    mobile = (SOURCE / mobile_source).read_text()
    before = ',R=v=>{const h=v.getBoundingClientRect();return h.bottom>=-et&&h.top<=window.innerHeight+et},N=ht(()=>{if(!i.value||!u.value||!w.value.length)return;const v=u.value.querySelectorAll("[data-resource-key]");if(!v.length)return;const h=[];v.forEach(U=>{if(!R(U))return;const Z=U.dataset.resourceKey;if(!Z)return;const re=L.value.get(Z);re&&h.push(re)}),h.length&&s.ensureResourceLinksValidity(r.currentChannelId,h)},_n),I=()=>{_t(()=>{N()})};ue(()=>r.currentChannelId,()=>{I()},{immediate:!0}),ue(w,()=>{I()},{deep:!0}),He(()=>{const v=document.querySelector("#app");v&&v.addEventListener("scroll",N),window.addEventListener("resize",N),I()}),mt(()=>{const v=document.querySelector("#app");v&&v.removeEventListener("scroll",N),window.removeEventListener("resize",N)})'
    after = ',N=keys=>{if(!i.value)return;const items=keys.map(key=>L.value.get(key)).filter(Boolean);if(items.length)s.ensureResourceLinksValidity(r.currentChannelId,items)},I=()=>{_t(()=>{R?.refresh()})};let R;ue(()=>r.currentChannelId,I,{immediate:!0});ue(w,I,{deep:!0});ue(i,I);He(()=>{if(u.value){R=observeResources(u.value,N,et);I()}});mt(()=>R?.disconnect())'
    mobile = 'import {observeResources} from "./' + Path(visibility_file).name + '";\n' + once(mobile, before, after)
    mobile = once(mobile, 'S-(P+k)<=1&&V(r.value)', 'S-(P+k)<=Math.max(600,P)&&V(r.value)')
    mobile = baidu_folders(mobile, mobile=True)
    mobile_file = "assets/ResourceList-clouddock-" + digest(mobile.encode())[:12] + ".js"
    (OUTPUT / mobile_file).write_text(mobile)
    main_source = "assets/main-qTjhG9aT.js"
    main_script = (SOURCE / main_source).read_text()
    main_script = once(main_script, 'Ya.use(rJ);', 'Ya.use(rJ,{observer:true,observerOptions:{root:document.querySelector("#app"),rootMargin:"800px 0px",threshold:0},adapter:{loading(item){item.el.setAttribute("decoding","async")}}});')
    # The bundled plugin otherwise still scans all images during Vue updates,
    # even in observer mode. Its existing event-mode fallback remains intact.
    main_script = once(main_script, 'lazyLoadHandler(){const t=[];', 'lazyLoadHandler(){if(this.mode===wo.observer)return;const t=[];')
    main_file = "assets/main-clouddock-" + digest(main_script.encode())[:12] + ".js"
    (OUTPUT / main_file).write_text(main_script)
    extension = OUTPUT / "clouddock"
    extension.mkdir(exist_ok=True)
    client_file = "clouddock/client-" + digest((ROOT / "web/client.js").read_bytes())[:12] + ".js"
    css_file = "clouddock/style-" + digest((ROOT / "web/clouddock.css").read_bytes())[:12] + ".css"
    shutil.copy2(ROOT / "web/client.js", OUTPUT / client_file)
    shutil.copy2(ROOT / "web/clouddock.css", OUTPUT / css_file)
    progress_files = {}
    for name in ("progress.js", "progress.css", "ariang-bridge.js"):
        data = (ROOT / "web" / name).read_bytes()
        stem, suffix = name.rsplit(".", 1)
        filename = "clouddock/" + stem + "-" + digest(data)[:12] + "." + suffix
        (OUTPUT / filename).write_bytes(data)
        progress_files[name] = filename
    progress = (ROOT / "web/progress.html").read_text()
    for marker, filename in {"__CLOUDDOCK_CSS__": css_file, "__CLOUDDOCK_CLIENT__": client_file, "__PROGRESS_CSS__": progress_files["progress.css"], "__PROGRESS_SCRIPT__": progress_files["progress.js"]}.items():
        progress = once(progress, marker, "/" + filename)
    progress_file = "clouddock/progress.html"
    (OUTPUT / progress_file).write_text(progress)
    shutil.copytree(ROOT / "upstream/ariang-nas", OUTPUT / "clouddock/ariang")
    aria_index = OUTPUT / "clouddock/ariang/index.html"
    aria_html = once(aria_index.read_text(), 'ng-href="#!/new"', 'href="/" target="_top"')
    aria_index.write_text(once(aria_html, "</body>", '<script src="/' + progress_files["ariang-bridge.js"] + '"></script></body>'))
    aria_files = [str(file.relative_to(OUTPUT)) for file in (OUTPUT / "clouddock/ariang").rglob("*") if file.is_file()]
    import_map = json.dumps({"imports": {"/" + FLOW: "/" + flow_file, "/" + resource_source: "/" + resource_file, "/" + desktop_source: "/" + desktop_file, "/" + mobile_source: "/" + mobile_file, "/" + main_source: "/" + main_file}}, separators=(",", ":"))
    additions = '<script type="importmap">' + import_map + '</script>\n<link rel="stylesheet" href="/' + css_file + '">\n<script defer src="/' + client_file + '"></script>\n'
    index = once((SOURCE / "index.html").read_text(), '<script type="module"', additions + '<script type="module"')
    index = once(index, 'src="/' + main_source + '"', 'src="/' + main_file + '"')
    (OUTPUT / "index.html").write_text(index)
    worker = (SOURCE / "sw.js").read_text()
    for file in ("index.html",):
        expression = r'url:"' + re.escape(file) + r'",revision:(?:null|"[^"]*")'
        replacement = 'url:' + json.dumps(file) + ',revision:' + json.dumps(digest((OUTPUT / file).read_bytes()))
        worker, count = re.subn(expression, replacement, worker)
        if count != 1:
            raise RuntimeError("Service Worker 缓存条目不匹配：" + file)
    new_files = [flow_file, resource_file, desktop_file, mobile_file, main_file, visibility_file, client_file, css_file, progress_file, *progress_files.values(), *aria_files]
    additions = [{"url": file, "revision": digest((OUTPUT / file).read_bytes())} for file in new_files]
    worker = once(worker, "precacheAndRoute([", "precacheAndRoute([" + ",".join(json.dumps(row, separators=(",", ":")) for row in additions) + ",")
    (OUTPUT / "sw.js").write_text(worker)
    changes = ["index.html", "sw.js", *new_files]
    manifest = {"base": "NAS CloudSaver v0.8.3", "entrypoints": {"flow": flow_file, "client": client_file, "css": css_file, "mobile": mobile_file, "main": main_file, "resource": resource_file, "desktop": desktop_file}, "visibility": visibility_file, "progress": {"page": progress_file, **progress_files}, "modified": changes, "upstreamFlowSha256": digest((SOURCE / FLOW).read_bytes()), "sha256": {file: digest((OUTPUT / file).read_bytes()) for file in changes}}
    (ROOT / "build/manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print("已生成 NAS v0.8.3 页面扩展和 AriaNg 下载进度入口；保留原页面和频道模块。")


if __name__ == "__main__":
    main()

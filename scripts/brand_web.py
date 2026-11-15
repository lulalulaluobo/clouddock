"""Checked UI-only branding and navigation patches; upstream stays untouched."""
import hashlib
import re


def remove_call(source, prefix, replacement=None):
    if replacement is None:
        replacement = ('e' if prefix.startswith('e(') else 's') + '("span",{hidden:true,"aria-hidden":"true"})'
    assert source.count(prefix) == 1, prefix
    start = source.index(prefix)
    index = source.index('(', start)
    depth, quote, escape = 0, '', False
    for pos in range(index, len(source)):
        char = source[pos]
        if quote:
            if escape: escape = False
            elif char == '\\': escape = True
            elif char == quote: quote = ''
        elif char in '\"\'`': quote = char
        elif char == '(': depth += 1
        elif char == ')':
            depth -= 1
            if depth == 0: return source[:start] + replacement + source[pos + 1:]
    raise RuntimeError('Unclosed call: ' + prefix)


def prepare_brand(root, source, output, main_script, once):
    mapping, files = {}, []
    def write(name, text):
        target = 'assets/' + name + '-clouddock-' + hashlib.sha256(text.encode()).hexdigest()[:12] + '.js'
        (output / target).write_text(text); files.append(target); return target
    extension = output / 'clouddock'; extension.mkdir(exist_ok=True)
    parser = (root / 'web/share-link.mjs').read_text()
    parser_file = 'clouddock/share-link-' + hashlib.sha256(parser.encode()).hexdigest()[:12] + '.js'
    (output / parser_file).write_text(parser); files.append(parser_file)
    page = (root / 'web/link-page.js').read_text().replace('__SHARE_LINK__', parser_file.split('/')[-1])
    page_file = 'clouddock/link-page-' + hashlib.sha256(page.encode()).hexdigest()[:12] + '.js'
    (output / page_file).write_text(page); files.append(page_file)
    logo_file = 'clouddock/logo.svg'
    (output / logo_file).write_bytes((root / 'web/clouddock-logo.svg').read_bytes()); files.append(logo_file)
    names = ['Home-BqrH2t5L.js', 'Home-ajRj3t7p.js', 'Setting-CDsrtQXy.js', 'Setting-cF4W330v.js', 'Login-BbPVA5Lr.js', 'Douban-BbhaVyAx.js', 'UserManagement--lIWg1Tu.js', 'Extension-BwKQeymO.js', 'useReleaseSupportPrompt-DNHszSUM.js', 'logo-y24umarI.js']
    for name in names:
        script = (source / 'assets' / name).read_text()
        # Only these display modules; never touch encryption or storage constants.
        script = script.replace('CloudSaver', 'CloudDock').replace('Cloud Saver', 'CloudDock')
        if name == 'logo-y24umarI.js': script = 'const s="/' + logo_file + '";export{s as _};'
        if name == 'useReleaseSupportPrompt-DNHszSUM.js':
            script = once(script, 'openIfNeeded:async()=>{await c(),u()&&(r.value=!0)}', 'openIfNeeded:async()=>{}')
        if name == 'Home-BqrH2t5L.js':
            script = once(script, '{index:"7",title:"鸣谢",icon:fe,router:"/thanks"},{index:"8",title:"关于与支持",icon:ve,router:"/about"}', '{index:"7",title:"链接转存",icon:me,router:"/transfer"}')
            script = remove_call(script, 'e("div",xt,[e("a",{href:l(Fe)')
        if name == 'Home-ajRj3t7p.js':
            script = once(script, 'a(M,{to:"/douban",icon:"video"}', 'a(M,{to:"/transfer",icon:"link-o"},{default:x(()=>[j("链接转存")]),_:1}),a(M,{to:"/douban",icon:"video"}')
        if name == 'Setting-CDsrtQXy.js':
            script = remove_call(script, 'o(r,{class:"meta-chip meta-chip--about"')
            # Remove the old help card, leaving channel/settings controls intact.
            script = remove_call(script, 's("div",El,[e[95]')
        if name == 'Setting-cF4W330v.js':
            script = remove_call(script, 's("div",ta,[e[35]')
        target = write(name.removesuffix('.js'), script)
        mapping['/assets/' + name] = '/' + target
    # Keep existing lazy loading/CSS dependency lists for the reused ResourceList.
    pattern = r'\{path:"/resource",name:"resource",component:(\(\)=>xn\(\(\)=>import\("\./ResourceList-[^"]+"\),__vite__mapDeps\(\[[^]]+\]\)\))\}'
    def add_route(match):
        loader = match.group(1)
        return match.group() + ',{path:"/transfer",name:"transfer",component:' + loader + '.then(m=>import("/' + page_file + '").then(p=>p.createTransferPage(m.default)))}'
    main_script, count = re.subn(pattern, add_route, main_script)
    assert count == 2, 'Resource routes changed'
    main_script = once(main_script, 'Ya.use(yJ);', 'yJ.beforeEach((to,from)=>{if(["/about","/thanks"].includes(to.path))return"/resource";if(from.path==="/login"&&["/","/resource"].includes(to.path)&&sessionStorage.getItem("clouddock_pending_transfer"))return"/transfer";return true});yJ.afterEach(()=>{document.title="CloudDock"});Ya.use(yJ);')
    return main_script, mapping, files

const { test } = require('node:test');
const assert = require('node:assert/strict');
test('可见性监听只提交附近卡片，分页追加、移除和卸载不留下监听', async () => {
  const { observeResources } = await import('../web/visible-resources.mjs');
  const saved = Object.fromEntries(['IntersectionObserver','requestAnimationFrame','cancelAnimationFrame','window'].map(k=>[k,global[k]]));
  let observer, sequence=0; const frames = new Map(), listeners = new Set(), calls=[];
  const root={addEventListener:()=>assert.fail('现代浏览器不应注册滚动扫描'),removeEventListener(){}};
  const card = key => ({dataset:{resourceKey:key},isConnected:true,getBoundingClientRect(){assert.fail('不应强制读取卡片布局')}});
  const a=card('a'),b=card('b'),c=card('c'); let list=[a,b];
  const container={closest:()=>root,querySelectorAll:()=>list};
  try {
    global.window={removeEventListener(){}};
    global.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence};
    global.cancelAnimationFrame=id=>frames.delete(id);
    global.IntersectionObserver=class {
      constructor(callback,options){observer=this;this.callback=callback;assert.equal(options.root,root)}
      observe(node){listeners.add(node)} unobserve(node){listeners.delete(node)} disconnect(){listeners.clear()}
    };
    const flush=()=>{const tasks=[...frames.values()];frames.clear();tasks.forEach(fn=>fn())};
    const watch=observeResources(container,keys=>calls.push(keys));watch.refresh();
    assert.equal(listeners.size,2);
    observer.callback([{target:a,isIntersecting:true},{target:b,isIntersecting:false}]);flush();
    assert.deepEqual(calls.at(-1),['a']);
    observer.callback([{target:a,isIntersecting:false},{target:b,isIntersecting:true}]);flush();
    assert.deepEqual(calls.at(-1),['b']);
    list=[b,c];a.isConnected=false;watch.refresh();flush();
    assert.deepEqual([...listeners],[b,c]);
    observer.callback([{target:c,isIntersecting:true}]);watch.disconnect();flush();
    assert.equal(listeners.size,0);assert.deepEqual(calls.at(-1),['b']);
  } finally { for(const [key,value] of Object.entries(saved)) { if(value===undefined)delete global[key];else global[key]=value; } }
});

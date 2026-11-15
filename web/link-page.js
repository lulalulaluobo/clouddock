import { x as defineComponent, r as ref, c as computed, P as node, n as nextTick } from '../assets/vue-BMb5FUKq.js';
import { u as useResource } from '../assets/resource-CodzvacV.js';
import { parseShareLink } from './__SHARE_LINK__';

export function createTransferPage(ResourceList) {
  return defineComponent({ name: 'CloudDockLinkTransfer', setup() {
    const store = useResource(), text = ref(''), code = ref(''), busy = ref(false), error = ref(''), parsed = ref(false);
    try {
      const raw = sessionStorage.getItem('clouddock_pending_transfer');
      if (raw) {
        const pending = JSON.parse(raw);
        if (Date.now() - pending.createdAt < 30 * 60 * 1000 && Date.now() >= pending.createdAt) {
          const link = parseShareLink(pending.url, pending.code);
          text.value = link.url; code.value = link.code;
        } else sessionStorage.removeItem('clouddock_pending_transfer');
      }
    } catch { sessionStorage.removeItem('clouddock_pending_transfer'); }
    const detected = computed(() => { try { return parseShareLink(text.value, code.value); } catch { return null; } });
    const submit = async event => {
      event.preventDefault(); if (busy.value) return;
      error.value = ''; parsed.value = false; sessionStorage.removeItem('clouddock_pending_transfer');
      let link; try { link = parseShareLink(text.value, code.value); } catch (failure) { error.value = failure.message; return; }
      busy.value = true;
      try { await store.parsingCloudLink(link.url); parsed.value = Boolean(store.resources?.some(group => group.list?.length)); if (!parsed.value) error.value = '未能读取分享，请检查链接、提取码及设置中的网盘登录状态'; else { await nextTick(); document.querySelector('.clouddock-link-results')?.scrollIntoView({ block: 'start' }); } }
      catch { error.value = '读取失败，请检查网盘登录状态后重试'; }
      finally { busy.value = false; }
    };
    return () => node('section', { class: 'clouddock-link-page' }, [
      node('div', { class: 'clouddock-link-card' }, [
        node('header', {}, [node('p', { class: 'clouddock-link-eyebrow' }, 'CLOUDDOCK'), node('h1', {}, '链接转存'), node('p', {}, '粘贴夸克或百度分享链接，选择资源后转存到网盘，也可同时下载到飞牛。')]),
        node('form', { onSubmit: submit }, [
          node('label', { for: 'clouddock-share-url' }, '分享链接'),
          node('textarea', { id: 'clouddock-share-url', value: text.value, rows: 4, maxlength: 8192, placeholder: '支持粘贴完整分享文案，自动识别链接和提取码', onInput: event => { sessionStorage.removeItem('clouddock_pending_transfer'); text.value = event.target.value; parsed.value = false; error.value = ''; }, disabled: busy.value, spellcheck: false }),
          node('div', { class: 'clouddock-link-fields' }, [node('div', {}, [node('label', { for: 'clouddock-share-code' }, '提取码（可选）'), node('input', { id: 'clouddock-share-code', value: code.value, maxlength: 4, placeholder: '已包含则无需填写', autocomplete: 'off', onInput: event => { sessionStorage.removeItem('clouddock_pending_transfer'); code.value = event.target.value; parsed.value = false; }, disabled: busy.value })]), node('p', { class: 'clouddock-link-provider', role: 'status' }, detected.value ? '已识别 · ' + detected.value.label : '支持夸克网盘 / 百度网盘')]),
          error.value ? node('p', { class: 'clouddock-error', role: 'alert' }, error.value) : null,
          node('button', { type: 'submit', disabled: busy.value || !text.value.trim(), class: 'clouddock-link-submit' }, busy.value ? '正在读取分享…' : '解析资源'),
          node('p', { class: 'clouddock-link-hint' }, '解析后点击“转存”，沿用资源勾选、网盘目录与飞牛目录选择。')
        ])
      ]), parsed.value ? node('div', { class: 'clouddock-link-results' }, [node(ResourceList)]) : null
    ]);
  } });
}

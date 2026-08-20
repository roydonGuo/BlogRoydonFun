import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Hello World — 博客开篇","description":"","frontmatter":{"title":"Hello World — 博客开篇","date":"2026-06-12T00:00:00.000Z","category":"随笔","cover":"/covers/life.svg","tags":["life","blog"],"excerpt":"这是我的第一篇博客文章，很高兴在这里与你相遇。"},"headers":[],"relativePath":"posts/hello-world.md","filePath":"posts/hello-world.md","lastUpdated":1781227232000}');
const _sfc_main = { name: "posts/hello-world.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="hello-world-—-博客开篇" tabindex="-1">Hello World — 博客开篇 <a class="header-anchor" href="#hello-world-—-博客开篇" aria-label="Permalink to “Hello World — 博客开篇”">​</a></h1><p>这是我的第一篇博客文章。</p><p>很高兴在这里与你相遇。这个博客将记录我在技术、设计和生活方面的思考与探索。</p><h2 id="为什么写博客" tabindex="-1">为什么写博客？ <a class="header-anchor" href="#为什么写博客" aria-label="Permalink to “为什么写博客？”">​</a></h2><p>一直想要一个属于自己的写作空间。在这里我可以：</p><ul><li>整理技术学习中的收获</li><li>记录生活中的灵感与感悟</li><li>分享设计和创意方面的思考</li></ul><p>写作是最好的思考方式。把想法写下来，不仅是记录，也是对知识的二次整理。</p><p>敬请期待更多内容！</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("posts/hello-world.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const helloWorld = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  helloWorld as default
};

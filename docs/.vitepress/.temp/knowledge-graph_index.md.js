import { resolveComponent, withCtx, createVNode, useSSRContext } from "vue";
import { ssrRenderAttrs, ssrRenderComponent } from "vue/server-renderer";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"知识图谱","description":"浏览博客文章、分类与标签之间的关联","frontmatter":{"title":"知识图谱","description":"浏览博客文章、分类与标签之间的关联","aside":false,"pageClass":"knowledge-graph-page"},"headers":[],"relativePath":"knowledge-graph/index.md","filePath":"knowledge-graph/index.md","lastUpdated":1786954506000}');
const _sfc_main = { name: "knowledge-graph/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  const _component_ClientOnly = resolveComponent("ClientOnly");
  const _component_KnowledgeGraph = resolveComponent("KnowledgeGraph");
  _push(`<div${ssrRenderAttrs(_attrs)} data-v-dc36a0aa><div class="graph-page-header" data-v-dc36a0aa><span class="graph-page-eyebrow" data-v-dc36a0aa>KNOWLEDGE GRAPH</span><h1 data-v-dc36a0aa>在文章之间，发现新的连接</h1><p data-v-dc36a0aa>每篇文章都是一个节点，分类与标签把散落的思考连接成一张持续生长的知识网络。</p></div>`);
  _push(ssrRenderComponent(_component_ClientOnly, null, {
    default: withCtx((_, _push2, _parent2, _scopeId) => {
      if (_push2) {
        _push2(ssrRenderComponent(_component_KnowledgeGraph, null, null, _parent2, _scopeId));
      } else {
        return [
          createVNode(_component_KnowledgeGraph)
        ];
      }
    }),
    _: 1
  }, _parent));
  _push(`</div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("knowledge-graph/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender], ["__scopeId", "data-v-dc36a0aa"]]);
export {
  __pageData,
  index as default
};

import { Ft as onMounted, K as createCommentVNode, Kn as ref, Vt as openBlock, nt as defineComponent, q as createElementBlock } from "./vue.runtime.esm-bundler-C3HlNeYZ.js";
//#region node_modules/.pnpm/@giscus+vue@3.1.1_vue@3.5.42/node_modules/@giscus/vue/dist/index.js
var d = [
	"id",
	"host",
	"repo",
	"repoid",
	"category",
	"categoryid",
	"mapping",
	"term",
	"strict",
	"reactionsenabled",
	"emitmetadata",
	"inputposition",
	"theme",
	"lang",
	"loading"
];
var l = /* @__PURE__ */ defineComponent({
	__name: "Giscus",
	props: {
		id: {},
		host: {},
		repo: {},
		repoId: {},
		category: {},
		categoryId: {},
		mapping: {},
		term: {},
		theme: {},
		strict: {},
		reactionsEnabled: {},
		emitMetadata: {},
		inputPosition: {},
		lang: {},
		loading: {}
	},
	setup(s) {
		const t = ref(!1);
		return onMounted(() => {
			import("./giscus-Ci9LqPcC-DMlVyTJO.js").then(() => t.value = !0);
		}), (e, m) => t.value ? (openBlock(), createElementBlock("giscus-widget", {
			key: 0,
			id: e.id,
			host: e.host,
			repo: e.repo,
			repoid: e.repoId,
			category: e.category,
			categoryid: e.categoryId,
			mapping: e.mapping,
			term: e.term,
			strict: e.strict,
			reactionsenabled: e.reactionsEnabled,
			emitmetadata: e.emitMetadata,
			inputposition: e.inputPosition,
			theme: e.theme,
			lang: e.lang,
			loading: e.loading
		}, null, 8, d)) : createCommentVNode("", !0);
	}
});
//#endregion
export { l as default };

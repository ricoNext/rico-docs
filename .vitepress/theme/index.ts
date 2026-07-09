// https://vitepress.dev/guide/custom-theme

import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import HermesRepoEntry from "./components/HermesRepoEntry.vue";
import "./style.css";

export default {
	extends: DefaultTheme,
	Layout: () => {
		return h(DefaultTheme.Layout, null, {
			"home-features-before": () => h(HermesRepoEntry),
		});
	},
	enhanceApp({ app, router, siteData }) {
		// ...
	},
} satisfies Theme;

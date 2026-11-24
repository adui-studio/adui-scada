import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import "@adui/normalize.css/all.css";
import "@adui/tailwind/styles.css";
import "@adui/scada-runtime/styles.css";
import { applyWorkspaceTheme, readWorkspaceTheme } from "@adui/scada-runtime";

applyWorkspaceTheme(readWorkspaceTheme());

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "home", component: () => import("./WorkspaceHome.vue") },
    { path: "/runtime", name: "runtime", component: () => import("./runtime/RuntimePage.vue") },
    { path: "/published", name: "published", component: () => import("./runtime/PublishedRuntimePage.vue") },
    { path: "/studio/:projectId?", name: "studio", component: () => import("./studio/StudioWorkspaceRoute.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
const app = createApp(App);
app.use(router);
void router.isReady().then(() => app.mount("#app"));

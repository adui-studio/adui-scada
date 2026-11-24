import { createApp } from "vue";
import App from "./App.vue";
import "@adui/normalize.css/all.css";
import "@adui/tailwind/styles.css";
import "@adui/scada-runtime/styles.css";
import { applyWorkspaceTheme, readWorkspaceTheme } from "@adui/scada-runtime";

applyWorkspaceTheme(readWorkspaceTheme());

createApp(App).mount("#app");

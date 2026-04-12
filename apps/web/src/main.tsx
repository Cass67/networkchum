import ReactDOM from "react-dom/client";

import { App } from "./App.js";

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />);
}

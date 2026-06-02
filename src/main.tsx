  import { createRoot } from "react-dom/client";
  import App from "./app/App";
  import "./styles/index.css";
  import { auth } from "./firebaseConfig";
  import { AppSettingsProvider } from "./app/context/AppSettingsContext";

  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    // Si la petición falla por estar offline o backend caído, lo capturamos
    if (typeof input === 'string' && input.includes('/api/') && !input.includes('/auth/login')) {
      if (auth.currentUser) {
        try {
          const token = await auth.currentUser.getIdToken();
          init = init || {};
          init.headers = {
            ...init.headers,
            'Authorization': `Bearer ${token}`
          };
        } catch (err) {
          console.warn("Fetch Interceptor Error:", err);
        }
      }
    }
    try {
      return await originalFetch(input, init);
    } catch (error) {
      console.warn('Fetch request failed:', input, error);
      // Retornar una respuesta mock para evitar que la UI se rompa
      return new Response(JSON.stringify(input.toString().includes('downloads') ? [] : {}), {
        status: 503, // Service Unavailable
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };

  createRoot(document.getElementById("root")!).render(
    <AppSettingsProvider>
      <App />
    </AppSettingsProvider>
  );

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
  

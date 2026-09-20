import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";
import AiTimeoutWatch from "./components/AiTimeoutWatch.jsx";
import Login from "./pages/Login.jsx";
import SitePicker from "./pages/SitePicker.jsx";
import Studio from "./pages/Studio.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [siteId, setSiteId] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setReady(true);
      return undefined;
    }
    api
      .me()
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch((err) => {
        if (cancelled) return;
        if (/session expired|sign in required/i.test(err.message || "")) {
          setToken(null);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <div className="boot">Opening the studio…</div>;
  }

  if (!user) {
    return (
      <Login
        onLogin={(payload) => {
          setToken(payload.token);
          setUser(payload.user);
        }}
      />
    );
  }

  if (!siteId) {
    return (
      <>
        <AiTimeoutWatch />
        <SitePicker
          user={user}
          onOpenSite={setSiteId}
          onLogout={() => {
            setToken(null);
            setUser(null);
            setSiteId(null);
          }}
        />
      </>
    );
  }

  return (
    <>
      <AiTimeoutWatch />
      <Studio
        user={user}
        siteId={siteId}
        onBack={() => setSiteId(null)}
        onLogout={() => {
          setToken(null);
          setUser(null);
          setSiteId(null);
        }}
      />
    </>
  );
}

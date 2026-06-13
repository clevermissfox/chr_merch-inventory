// app/routes/merch.tsx
import { Outlet } from "react-router";
import AuthCheck from "../components/AuthCheck";
import { MerchShell } from "../components/MerchShell";

export default function MerchLayout() {
  return (
    <AuthCheck requireAuth={true}>
      {(user) => (
        <MerchShell eyebrow="CHR Merch" title="Merch Hub">
          <Outlet />
        </MerchShell>
      )}
    </AuthCheck>
  );
}

import { redirect } from "react-router";

export function loader() {
  return redirect("/merch");
}

export default function HomeRedirect() {
  return null;
}

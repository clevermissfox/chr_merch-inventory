export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const target =
      "https://script.google.com/macros/s/AKfycbxNNnFrkEde77Z8IXIxBIQzJXvXipEriot55R6sOLkQcg8-EjbWrKNeP18xUDU7Vx80VA/exec";

    const method = request.method;
    const url = new URL(target);

    if (method === "GET") {
      for (const [key, value] of new URL(request.url).searchParams.entries()) {
        url.searchParams.set(key, value);
      }
    }

    const init = {
      method,
      redirect: "manual",
      headers: {},
    };

    if (method === "POST") {
      init.body = await request.arrayBuffer();
      init.headers["content-type"] =
        request.headers.get("content-type") || "application/json";
    }

    const first = await fetch(url.toString(), init);

    if (first.status >= 300 && first.status < 400) {
      const loc = first.headers.get("Location");
      if (!loc) {
        return new Response("Redirect with no Location", { status: 502 });
      }

      const second = await fetch(loc, init);
      return new Response(await second.text(), { status: second.status });
    }

    return new Response(await first.text(), { status: first.status });
  },
};

/* This worker is available at https://chr-merch-node.dev-7a0.workers.dev/ */

const url =
  "https://script.google.com/macros/s/AKfycbxNNnFrkEde77Z8IXIxBIQzJXvXipEriot55R6sOLkQcg8-EjbWrKNeP18xUDU7Vx80VA/exec";
const staging_url =
  "https://script.google.com/macros/s/AKfycbwfLfR_coCZQpoKWTj8Cm7Ltyd88guaYfUdhozH3KdropK6wYC3fp-x6oUEgh6X1gLGeA/exec";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Health check endpoint (use specific path, not trailing slash)
    if (request.url.endsWith("/health") || request.url.endsWith("/health/")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // GET endpoint to fetch submissions
    if (request.method === "GET") {
      try {
        // Extract query params from the incoming request
        const requestUrl = new URL(request.url);
        const queryParams = requestUrl.searchParams;

        // Build the full GAS URL with query params
        const googleScriptUrlWithParams = new URL(url);
        queryParams.forEach((value, key) => {
          if (key !== "host") {
            googleScriptUrlWithParams.searchParams.set(key, value);
          }
        });

        const fullGASUrl = googleScriptUrlWithParams.toString();
        console.log("Fetching from GAS with URL:", fullGASUrl);

        const response = await fetch(fullGASUrl, {
          method: "GET",
          redirect: "follow",
        });

        console.log("GAS response status:", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("GAS error:", errorText);
          return new Response(
            JSON.stringify({
              success: false,
              error: `Google Apps Script returned status ${response.status}`,
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }

        const resultText = await response.text();
        console.log("GAS response text length:", resultText.length);

        let parsedResult;
        try {
          parsedResult = JSON.parse(resultText);
        } catch (e) {
          console.error(
            "Response is not valid JSON:",
            resultText.substring(0, 200),
          );
          return new Response(
            JSON.stringify({
              success: false,
              error: "Google Apps Script returned invalid JSON",
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }

        console.log(
          "Fetched submissions count:",
          parsedResult.data?.length || 0,
        );

        return new Response(
          JSON.stringify({
            success: true,
            data: parsedResult.data || [],
          }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          },
        );
      } catch (error) {
        console.error("Fetch error:", error.message);
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message || "Failed to fetch submissions",
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          },
        );
      }
    }

    // POST endpoint
    if (request.method === "POST") {
      try {
        const body = await request.json();
        console.log("Received POST body:", body);
        console.log("Forwarding to GAS:", body);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body), // Send original body directly
          redirect: "follow",
        });

        console.log("GAS response status:", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("GAS error:", errorText);
          return new Response(
            JSON.stringify({
              success: false,
              error: `Google Apps Script returned status ${response.status}`,
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        const resultText = await response.text();
        console.log("GAS response text:", resultText.substring(0, 500));

        let parsedResult;
        try {
          parsedResult = JSON.parse(resultText);
        } catch (e) {
          console.error(
            "Response is not valid JSON:",
            resultText.substring(0, 200),
          );
          return new Response(
            JSON.stringify({
              success: false,
              error: "Google Apps Script returned invalid JSON",
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // Check for success in your Apps Script response format
        if (parsedResult.ok !== true) {
          console.error("GAS did not confirm success:", parsedResult);
          return new Response(
            JSON.stringify({
              success: false,
              error: "Google Apps Script did not confirm success",
              result: parsedResult,
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        console.log("POST successful");

        return new Response(
          JSON.stringify({
            success: true,
            result: parsedResult,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      } catch (error) {
        console.error("POST error:", error.message);
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message || "Failed to process POST request",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // Method not allowed
    return new Response(
      JSON.stringify({
        success: false,
        error: "Method not allowed",
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  },
};

/* This worker is available at https://chr-merch-node.dev-7a0.workers.dev/ */
// NEED THE -i flag or it returns 'curl: (6) Could not resolve host: chr-merch-node.dev-7a0'
// curl -i -X POST "https://chr-merch-node.dev-7a0.workers.dev/" \
//   -H "Content-Type: application/json" \
//   -d '{"action":"test"}'

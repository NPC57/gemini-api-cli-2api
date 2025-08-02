import {
  AuthType,
  createCodeAssistContentGenerator,
} from "npm:@google/gemini-cli-core@0.1.4";
import { arch, env, platform } from "node:process";
import { GaxiosError } from "npm:gaxios@6.7.1";

env.CLI_VERSION ||= "0.1.4";

let codeAssist;
try {
  console.log("Initializing Code Assist Generator...");
  codeAssist = await createCodeAssistContentGenerator(
    {
      headers: {
        "User-Agent": `GeminiCLI/${env.CLI_VERSION} (${platform}; ${arch})`,
      },
    },
    AuthType.LOGIN_WITH_GOOGLE_PERSONAL,
  );
  console.log("Code Assist Generator initialized successfully!");
} catch (error) {
  console.error("Failed to initialize Code Assist Generator:", error);
  Deno.exit(1); // 退出程序，防止卡住
}

Deno.serve({ port: Deno.env.get("PORT") ? Number(Deno.env.get("PORT")) : 8000 }, async (req) => {
  const pathname = new URL(req.url).pathname;
  
  // --- Start of Modification ---
  let [model, action] = pathname
    .split("/")
    .find((part) => part.includes(":"))
    ?.split(":") ?? [];

  // Whatever model the client sends, we force it to be the one that works!
  model = "gemini-2.5-pro";
  // --- End of Modification ---

  if (!model || !action) {
    return new Response("Invalid request", {
      status: 400,
    });
  }

  const payload = await req.json().catch(() => ({}));

  // Uncomment for debugging
  // console.info(model, action, payload);

  const getGenerateContentParameters = () => ({
    model,
    contents: payload.contents,
    config: {
      ...payload.generationConfig,
      tools: payload.tools,
      toolConfig: payload.toolConfig,
      safetySettings: payload.safetySettings,
      systemInstruction: payload.systemInstruction,
      abortSignal: req.signal,
    },
  } as const);

  try {
    switch (action) {
      case "generateContent": {
        const result = await codeAssist.generateContent(
          getGenerateContentParameters(),
        );
        return Response.json(result);
      }
      case "streamGenerateContent": {
        const stream = await codeAssist.generateContentStream(
          getGenerateContentParameters(),
        );

        const sseStream = async function* () {
          try {
            for await (const chunk of stream) {
              yield `data: ${JSON.stringify(chunk)}\n\n`;
            }
          } catch (error) {
            console.error("Error in SSE stream:", error);
          }
        }();

        return new Response(
          ReadableStream.from(sseStream).pipeThrough(new TextEncoderStream()),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "Transfer-Encoding": "chunked",
            },
          },
        );
      }

      case "countTokens": {
        const result = await codeAssist.countTokens({
          model,
          contents: payload.contents,
          config: {
            ...payload.generateContentRequest,
            abortSignal: req.signal,
          },
        });
        return Response.json(result);
      }
      case "embedContent": {
        const result = await codeAssist.embedContent({
          model,
          contents: payload.contents,
          config: {
            taskType: payload.taskType,
            title: payload.title,
            outputDimensionality: payload.outputDimensionality,
            abortSignal: req.signal,
          },
        });
        return Response.json(result);
      }
      default: {
        return new Response(`Invalid action: ${action}`, {
          status: 400,
        });
      }
    }
  } catch (error) {
    if (error instanceof GaxiosError && error.response) {
      return Response.json(error.response.data, {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers,
      });
    }
    console.error("Error processing request:", error);
    return new Response("Internal Server Error", {
      status: 500,
    });
  }
});
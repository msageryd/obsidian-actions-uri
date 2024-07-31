import * as http from "http";
import { normalizePath, ObsidianProtocolData, Plugin } from "obsidian";
import { z, ZodError } from "zod";
import { AnyParams, RoutePath, routes } from "src/routes";
import { URI_NAMESPACE } from "src/constants";
import { HandlerFunction, PluginSettings, ProcessingResult } from "src/types";

interface CallHandler {
  (handlerFunc: HandlerFunction, params: AnyParams): Promise<ProcessingResult>;
}

interface ErrorHandler {
  (parseError: ZodError, params: ObsidianProtocolData): void;
}

interface ActionsURIPlugin extends Plugin {
  settings: PluginSettings;
  handleIncomingCall: CallHandler;
  handleParseError: ErrorHandler;
}

export class HttpServer {
  private registeredRoutes: Record<string, HandlerFunction> = {};
  private server: http.Server | null = null;
  private plugin: ActionsURIPlugin;

  constructor(plugin: ActionsURIPlugin) {
    this.plugin = plugin;
    this.registerRoutes(routes);
  }

  private createServer(): http.Server {
    return http.createServer(
      async (req: http.IncomingMessage, res: http.ServerResponse) => {
        const parsedUrl = new URL(req.url || "/", `http://${req.headers.host}`);

        // Get the query parameters
        const pathname = parsedUrl.pathname;

        // Get all query parameters as a single object
        const queryParams = Object.fromEntries(parsedUrl.searchParams);

        if (this.registeredRoutes[pathname]) {
          console.log(queryParams);
          const result = await this.registeredRoutes[pathname]({
            ...queryParams,
            action: pathname,
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(404);
          res.end();
        }
      }
    );
  }

  private registerRoutes(routeTree: RoutePath) {
    for (const [routePath, routeSubpaths] of Object.entries(routeTree)) {
      for (const route of routeSubpaths) {
        const { path, schema, handler } = route;
        const fullPath = normalizePath(
          `${URI_NAMESPACE}/${routePath}/${path}`
        ).replace(/\/$/, "");

        this.registeredRoutes["/" + fullPath] = async (incomingParams) => {
          const res = await schema.safeParseAsync(incomingParams);
          return res.success
            ? await this.plugin.handleIncomingCall(
                handler,
                res.data as z.infer<typeof schema>
              )
            : this.plugin.handleParseError(res.error, incomingParams);
        };
      }
    }
  }

  startServer(): Promise<void> {
    const port = 3000;
    return new Promise((resolve, reject) => {
      if (!this.server) {
        this.server = this.createServer();
      }
      this.server.listen(port, () => {
        console.log(`HTTP Server running on port: ${port}`);
        resolve();
      });
    });
  }

  stopServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

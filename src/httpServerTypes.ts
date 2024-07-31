export interface IHttpServer {
  startServer: () => Promise<void>;
  stopServer: () => void;
}

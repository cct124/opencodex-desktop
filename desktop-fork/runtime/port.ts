import { createServer } from "node:net";
import { DesktopConnectionError, type ConnectionState } from "./persistent";

/** Probe one loopback port; the CLI must subsequently bind that exact port or fail. */
export async function selectDesktopPort(state?: ConnectionState): Promise<number> {
  // Old installations already recorded their last Codex endpoint in the lease.
  const preferred = state?.listenPort ?? state?.lease?.port ?? 0;
  return await new Promise<number>((accept, reject) => {
    const reservation = createServer();
    reservation.once("error", (error: NodeJS.ErrnoException) => {
      if (preferred && (error.code === "EADDRINUSE" || error.code === "EACCES")) {
        reject(new DesktopConnectionError(`桌面代理端口 ${preferred} 已被占用或无法监听。请释放该端口后重试；为保持 Codex 连接地址不变，不会自动改用其他端口。`));
      } else {
        reject(error);
      }
    });
    reservation.listen({ port: preferred, host: "127.0.0.1", exclusive: true }, () => {
      const address = reservation.address();
      reservation.close(error => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("Cannot allocate a loopback port"));
        else accept(address.port);
      });
    });
  });
}

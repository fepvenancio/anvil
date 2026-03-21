import pino from 'pino';
import { join } from 'node:path';

export function createLogger(anvilDir: string, level: string = 'info'): pino.Logger {
  return pino({
    level,
    transport: {
      targets: [
        {
          target: 'pino/file',
          options: { destination: join(anvilDir, 'logs', 'anvil.log'), mkdir: true },
          level,
        },
      ],
    },
  });
}

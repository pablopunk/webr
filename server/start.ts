import { redirectOutputToLogFile } from './log-file';
import { runServer } from './run';

redirectOutputToLogFile();
await runServer();

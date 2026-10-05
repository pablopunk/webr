import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';

const LAN = [{ address: '192.168.0.10', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '192.168.0.10/24' }];
os.networkInterfaces = () => ({ en0: LAN }) as ReturnType<typeof os.networkInterfaces>;
syncBuiltinESMExports();

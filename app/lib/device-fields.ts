export const hardwareFieldDefinitions = [
  { key: 'storage', label: 'Storage / drives', exportLabel: 'Storage', description: 'SSD, HDD, NVMe, M.2 and eMMC devices.' },
  { key: 'graphics', label: 'GPU / graphics', exportLabel: 'Graphics', description: 'Integrated and discrete graphics listed by HP.' },
  { key: 'display', label: 'Display / panel', exportLabel: 'Display / panel', description: 'LCD, panel, touchscreen and display assemblies.' },
  { key: 'battery', label: 'Battery', exportLabel: 'Battery', description: 'Battery assemblies and serial-specific battery descriptions.' },
  { key: 'network', label: 'WLAN / LAN', exportLabel: 'WLAN / LAN', description: 'Wi-Fi, Bluetooth, Ethernet, LAN and NIC components.' },
  { key: 'power', label: 'AC adapter / power', exportLabel: 'AC adapter / power', description: 'AC adapters, power supplies and PSU information.' },
  { key: 'keyboard', label: 'Keyboard', exportLabel: 'Keyboard', description: 'Keyboard, top-cover keyboard and regional keyboard assemblies.' },
  { key: 'systemBoard', label: 'System board', exportLabel: 'System board', description: 'Motherboard, mainboard and system-board descriptions.' },
  { key: 'operatingSystem', label: 'Operating system', exportLabel: 'Operating system', description: 'Windows, ChromeOS, FreeDOS and digital product keys when listed.' },
  { key: 'optical', label: 'Optical drive', exportLabel: 'Optical drive', description: 'DVD, CD-ROM and optical-drive components.' },
  { key: 'audio', label: 'Audio', exportLabel: 'Audio', description: 'Speakers, microphones and audio components.' },
  { key: 'otherComponents', label: 'Other components', exportLabel: 'Other configuration', description: 'Uncategorised serial-specific configuration returned by HP.' },
] as const;

export type HardwareFieldKey = typeof hardwareFieldDefinitions[number]['key'];

export type DeviceMoreInfo = Record<HardwareFieldKey, string[]> & {
  buildId: string;
  featureByte: string;
  macAddress: string;
  manufactureDate: string;
  uuid: string;
  rohsStatus: string;
  configurationItems: Array<{ partNumber: string; description: string; quantity: string }>;
  sparePartCount: number;
};

export const defaultHardwareFields: HardwareFieldKey[] = hardwareFieldDefinitions.map(({ key }) => key);

export function createEmptyMoreInfo(): DeviceMoreInfo {
  return {
    storage: [], graphics: [], display: [], battery: [], network: [], power: [], keyboard: [],
    systemBoard: [], operatingSystem: [], optical: [], audio: [], otherComponents: [],
    buildId: '', featureByte: '', macAddress: '', manufactureDate: '', uuid: '', rohsStatus: '',
    configurationItems: [], sparePartCount: 0,
  };
}

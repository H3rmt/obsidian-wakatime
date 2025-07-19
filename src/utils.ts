export function quote(str: string): string {
  if (str.includes(' ')) return `"${str.replace('"', '\\"')}"`;
  return str;
}

export function apiKeyInvalid(key?: string): string {
  const err =
    'Invalid api key... check https://wakatime.com/settings for your key';
  if (!key) return err;
  // allow keys from wakapi without the waka_ prefix
  // const re = new RegExp(
  //   '^(waka_)?[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$',
  //   'i',
  // );
  // if (!re.test(key)) return err;
  return '';
}

export function formatDate(date: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  let ampm = 'AM';
  let hour = date.getHours();
  if (hour > 11) {
    ampm = 'PM';
    hour = hour - 12;
  }
  if (hour === 0) {
    hour = 12;
  }
  const minute = date.getMinutes();
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${hour}:${
    minute < 10 ? `0${minute}` : minute
  } ${ampm}`;
}

export function obfuscateKey(key: string): string {
  let newKey = '';
  if (key) {
    newKey = key;
    if (key.length > 4)
      newKey = `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXX${key.substring(key.length - 4)}`;
  }
  return newKey;
}

export function wrapArg(arg: string): string {
  if (arg.indexOf(' ') > -1) return `"${arg.replace(/"/g, '\\"')}"`;
  return arg;
}

export function formatArguments(binary: string, args: string[]): string {
  const clone = args.slice(0);
  clone.unshift(wrapArg(binary));
  const newCmds: string[] = [];
  let lastCmd = '';
  for (let i = 0; i < clone.length; i++) {
    if (lastCmd === '--key') newCmds.push(wrapArg(obfuscateKey(clone[i])));
    else newCmds.push(wrapArg(clone[i]));
    lastCmd = clone[i];
  }
  return newCmds.join(' ');
}

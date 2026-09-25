// Воркер у Docker бачить лише внутрішню адресу контейнера (172.x / 10.x / 192.168.x), до якої браузер
// користувача не достукається. Порти 10000-10050/udp опубліковані назовні, тому в SDP і ICE-кандидатах
// приватна адреса замінюється на ту, за якою сервер доступний клієнтам (WEBRTC_ANNOUNCED_IP):
// публічна IP сервера на продакшні, 127.0.0.1 - при локальному запуску.
const PRIVATE_IPV4 = /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g;

export function announcedIp(): string | undefined {
  return process.env.WEBRTC_ANNOUNCED_IP?.trim() || undefined;
}

export function announcePrivateAddresses(text: string, ip = announcedIp()): string {
  return ip ? text.replace(PRIVATE_IPV4, ip) : text;
}

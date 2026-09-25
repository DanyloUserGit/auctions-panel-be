import { announcePrivateAddresses } from './announce';

describe('announcePrivateAddresses', () => {
  it('replaces the private container address with the announced one in candidates and SDP', () => {
    const candidate = 'candidate:ceba6e81 1 udp 2130706431 172.18.0.7 10001 typ host generation 0';
    expect(announcePrivateAddresses(candidate, '127.0.0.1')).toBe('candidate:ceba6e81 1 udp 2130706431 127.0.0.1 10001 typ host generation 0');
    expect(announcePrivateAddresses('c=IN IP4 10.0.3.5\r\na=candidate:1 1 udp 1 192.168.1.20 10002 typ host', '203.0.113.10'))
      .toBe('c=IN IP4 203.0.113.10\r\na=candidate:1 1 udp 1 203.0.113.10 10002 typ host');
  });

  it('keeps public addresses and does nothing without an announced IP', () => {
    const srflx = 'candidate:a0 1 udp 1694498815 188.163.113.12 48229 typ srflx raddr 172.18.0.7 rport 10001';
    expect(announcePrivateAddresses(srflx, '127.0.0.1')).toContain('188.163.113.12 48229');
    expect(announcePrivateAddresses('172.18.0.7', undefined)).toBe('172.18.0.7');
    expect(announcePrivateAddresses('172.32.0.1', '127.0.0.1')).toBe('172.32.0.1');
  });
});

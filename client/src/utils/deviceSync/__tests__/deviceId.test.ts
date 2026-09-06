import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectDeviceName, detectDeviceType, getOrCreateDeviceId } from '../deviceId'

const KEY = 'aivinnet.device_id'

const UA = {
    chromeWin:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    edgeWin:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
    safariIphone:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    chromeAndroid:
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    safariMac:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
}

describe('getOrCreateDeviceId', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('creates, persists and returns a stable id across calls', () => {
        const first = getOrCreateDeviceId()
        expect(first).toBeTruthy()
        expect(localStorage.getItem(KEY)).toBe(first)

        const second = getOrCreateDeviceId()
        expect(second).toBe(first)
    })

    it('reuses an id already present in localStorage', () => {
        localStorage.setItem(KEY, 'preset-device-id')
        expect(getOrCreateDeviceId()).toBe('preset-device-id')
    })
})

describe('detectDeviceName', () => {
    it('names common browser/OS combinations', () => {
        expect(detectDeviceName(UA.chromeWin)).toBe('Chrome on Windows')
        expect(detectDeviceName(UA.edgeWin)).toBe('Edge on Windows')
        expect(detectDeviceName(UA.firefoxLinux)).toBe('Firefox on Linux')
        expect(detectDeviceName(UA.safariIphone)).toBe('Safari on iPhone')
        expect(detectDeviceName(UA.chromeAndroid)).toBe('Chrome on Android')
        expect(detectDeviceName(UA.safariMac)).toBe('Safari on macOS')
    })

    it('falls back to "Browser" for an unrecognised user agent', () => {
        expect(detectDeviceName('')).toBe('Browser')
        expect(detectDeviceName('SomeUnknownAgent/1.0')).toBe('Browser')
    })
})

describe('detectDeviceType', () => {
    it('classifies mobile vs desktop', () => {
        expect(detectDeviceType(UA.chromeWin)).toBe('desktop')
        expect(detectDeviceType(UA.firefoxLinux)).toBe('desktop')
        expect(detectDeviceType(UA.safariMac)).toBe('desktop')
        expect(detectDeviceType(UA.safariIphone)).toBe('mobile')
        expect(detectDeviceType(UA.chromeAndroid)).toBe('mobile')
    })
})

describe('user-agent default from navigator', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('reads navigator.userAgent when no argument is passed', () => {
        vi.stubGlobal('navigator', { userAgent: UA.safariIphone })
        expect(detectDeviceName()).toBe('Safari on iPhone')
        expect(detectDeviceType()).toBe('mobile')
    })
})

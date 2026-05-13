/**
 * IP地址获取和验证工具函数
 */

/**
 * 获取客户端真实IP地址（考虑Nginx代理）
 */
export function getRealClientIP(req: any): string {
    // 优先级顺序：
    // 1. X-Forwarded-For (最常用的代理头)
    // 2. X-Real-IP (Nginx常用)
    // 3. X-Client-IP
    // 4. CF-Connecting-IP (Cloudflare)
    // 5. req.ip (Express默认)
    // 6. connection.remoteAddress (备用)

    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        // X-Forwarded-For 可能包含多个IP，取第一个（真实客户端IP）
        const ips = xForwardedFor.split(',').map((ip: string) => ip.trim());
        const clientIP = ips[0];
        if (isValidIP(clientIP)) {
            return clientIP;
        }
    }

    const xRealIP = req.headers['x-real-ip'];
    if (xRealIP && isValidIP(xRealIP)) {
        return xRealIP;
    }

    const xClientIP = req.headers['x-client-ip'];
    if (xClientIP && isValidIP(xClientIP)) {
        return xClientIP;
    }

    const cfConnectingIP = req.headers['cf-connecting-ip'];
    if (cfConnectingIP && isValidIP(cfConnectingIP)) {
        return cfConnectingIP;
    }

    // 备用方案
    const reqIP = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
    if (reqIP && isValidIP(reqIP)) {
        return reqIP;
    }

    // 最后的备用IP
    return '127.0.0.1';
}

/**
 * 验证IP地址格式是否有效
 */
export function isValidIP(ip: string): boolean {
    if (!ip || typeof ip !== 'string') {
        return false;
    }

    // 移除可能的端口号
    const cleanIP = ip.split(':')[0];

    // 过滤掉明显无效的IP
    if (cleanIP === 'localhost' || cleanIP === '::1' || cleanIP === '') {
        return false;
    }

    // 简单的IP格式验证
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

    return ipv4Regex.test(cleanIP) || ipv6Regex.test(cleanIP);
}

/**
 * 判断是否为公网IP
 */
export function isPublicIP(ip: string): boolean {
    if (!isValidIP(ip)) {
        return false;
    }

    const cleanIP = ip.split(':')[0];

    // 内网IP范围
    if (cleanIP === '127.0.0.1' ||
        cleanIP.startsWith('10.') ||
        cleanIP.startsWith('192.168.') ||
        cleanIP.startsWith('172.')) {
        return false;
    }

    return true;
}

/**
 * 获取IP地址的地理位置信息（简单版本）
 */
export function getIPInfo(ip: string): { isPrivate: boolean; type: 'ipv4' | 'ipv6' | 'invalid' } {
    if (!isValidIP(ip)) {
        return { isPrivate: false, type: 'invalid' };
    }

    const cleanIP = ip.split(':')[0];
    const isIPv6 = cleanIP.includes(':');
    const isPrivate = !isPublicIP(ip);

    return {
        isPrivate,
        type: isIPv6 ? 'ipv6' : 'ipv4'
    };
}

import { API_CONFIG } from '@/lib/config';
import { getSiteConfig } from '@/lib/site';

// API响应类型
export interface ApiResponse<T = any> {
    code: number;
    message: string;
    data: T;
}

// 请求选项类型
export interface RequestOptions {
    headers?: Record<string, string>;
    params?: Record<string, string>;
    timeout?: number;
    /**
     * Auth behavior for this request.
     * - 'none': do not attach Authorization header
     * - 'optional' (default): attach Authorization header when available
     * - 'required': require Authorization header (throws when missing)
     */
    auth?: 'none' | 'optional' | 'required';
}

// API错误类型
export class ApiError extends Error {
    code: number;

    constructor(message: string, code: number = -1) {
        super(message);
        this.code = code;
        this.name = 'ApiError';
    }
}

/**
 * API客户端服务
 */
class ApiClient {
    private baseUrl: string;
    private readonly localDevToken = 'nolanx-local-dev-token';

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    /**
     * Extract more specific error messages from backend responses (e.g. validation errors),
     * so users don't only see a generic "Invalid parameters".
     */
    private extractErrorMessage(errorData: any): string | null {
        const messages: string[] = [];

        const push = (value: unknown) => {
            if (typeof value !== 'string') return;
            const trimmed = value.trim();
            if (!trimmed) return;
            messages.push(trimmed);
        };

        const collect = (value: unknown) => {
            if (value === null || value === undefined) return;
            if (Array.isArray(value)) {
                value.forEach(collect);
                return;
            }
            push(value);
        };

        // Common format: { message, errors: { message: string[] } }
        if (errorData?.errors) {
            const errors = errorData.errors;

            if (errors && typeof errors === 'object') {
                if ('message' in errors) {
                    collect((errors as any).message);
                }

                // Field-level: { errors: { website: ['...'], email: ['...'] } }
                Object.entries(errors as Record<string, unknown>).forEach(([key, value]) => {
                    if (key === 'message') return;
                    collect(value);
                });
            } else {
                collect(errors);
            }
        }

        // Nest default: { message: string[] }
        collect(errorData?.message);

        const unique = Array.from(new Set(messages));
        if (unique.length === 0) return null;

        const filtered = unique.filter(msg => {
            const normalized = msg.toLowerCase();
            return normalized !== 'invalid parameters' && normalized !== 'bad request';
        });

        const finalMessages = (filtered.length > 0 ? filtered : unique)
            .slice(0, 3)
            .map(msg => (msg.length > 200 ? `${msg.slice(0, 200)}…` : msg));

        return finalMessages.join(' ');
    }

    private extractErrorCode(errorData: any): number | null {
        const candidates = [
            errorData?.code,
            errorData?.statusCode,
            errorData?.errors?.statusCode,
        ];

        for (const candidate of candidates) {
            const num = typeof candidate === 'string' ? Number(candidate) : candidate;
            if (typeof num === 'number' && Number.isFinite(num)) {
                return num;
            }
        }

        return null;
    }

    private async getAuthHeaders(authMode: 'optional' | 'required' = 'optional'): Promise<Record<string, string> | null> {
        if (typeof window !== 'undefined') {
            try {
                sessionStorage.setItem('token', this.localDevToken);
            } catch {
                // ignore storage failures
            }
        }

        if (authMode === 'none') return null;
        return { Authorization: `Bearer ${this.localDevToken}` };
    }

    /**
     * 构造完整URL
     */
    private buildUrl(endpoint: string, params?: Record<string, string>): string {
        let url = `${this.baseUrl}${endpoint}`;

        // 添加查询参数
        if (params && Object.keys(params).length > 0) {
            const queryParams = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    queryParams.append(key, value);
                }
            });

            url += `?${queryParams.toString()}`;
        }

        return url;
    }

    /**
     * 处理HTTP响应
     */
    private async handleResponse<T>(response: Response): Promise<T> {
        if (!response.ok) {
            let errorMessage = '请求失败';
            let errorCode = -1;

            try {
                const errorData = await response.json();
                errorMessage = this.extractErrorMessage(errorData) || errorData.message || errorMessage;
                errorCode = this.extractErrorCode(errorData) ?? errorData.code ?? errorCode;
            } catch (e) {
                // 如果无法解析响应体，使用HTTP状态码和状态文本
                errorCode = response.status;
                errorMessage = response.statusText || errorMessage;
            }

            if (response.status === 401) {
                errorMessage = 'Please login first';
            }

            throw new ApiError(errorMessage, errorCode);
        }

        // 处理204 No Content状态码 - 没有响应体
        if (response.status === 204) {
            return {} as T;
        }

        const data = await response.json();
        return data as T;
    }

    /**
     * 发送HTTP请求
     */
    private async request<T>(
        method: string,
        endpoint: string,
        data?: any,
        options: RequestOptions = {},
    ): Promise<T> {
        const {
            headers = {},
            params,
            timeout = API_CONFIG.TIMEOUT,
            auth = 'optional',
        } = options;

        // 构建URL
        const url = this.buildUrl(endpoint, params);

        // 设置超时控制器
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            // 准备请求头
            let requestHeaders: Record<string, string> = {
                'Content-Type': 'application/json',
                ...headers,
            };

            // Add essential headers for server-side requests to avoid WAF/referrer-based blocks
            if (typeof window === 'undefined') {
                requestHeaders['Accept'] = requestHeaders['Accept'] ?? 'application/json, text/plain;q=0.9,*/*;q=0.8';
                requestHeaders['Accept-Language'] = requestHeaders['Accept-Language'] ?? 'en-US,en;q=0.9';
                const appUrl = getSiteConfig().appUrl;
                // Provide stable Referer/Origin for SSR calls
                requestHeaders['Referer'] = requestHeaders['Referer'] ?? appUrl;
                requestHeaders['Origin'] = requestHeaders['Origin'] ?? appUrl;
                // Set a predictable UA for WAF rules
                requestHeaders['User-Agent'] = requestHeaders['User-Agent'] ?? 'ReelMindSSR/1.0';
                // Correlation id
                const reqId = (requestHeaders['X-Request-Id'] as string) || `SSR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                requestHeaders['X-Request-Id'] = reqId;
                requestHeaders['X-Server-Render'] = 'true';
                console.debug(`[ApiClient][SSR] ${method} ${endpoint} reqId=${reqId}`);
            }

            // 尝试为所有请求添加认证头（如果用户已登录）
            if (auth !== 'none') {
                const authHeaders = await this.getAuthHeaders(auth);
                if (authHeaders) {
                    requestHeaders = { ...requestHeaders, ...authHeaders };
                }
            }

            // 发送请求
            const response = await fetch(url, {
                method,
                headers: requestHeaders,
                body: data ? JSON.stringify(data) : undefined,
                signal: controller.signal,
            });

            // 处理响应
            return await this.handleResponse<T>(response);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new ApiError('请求超时', 408);
            }

            if (error instanceof ApiError) {
                throw error;
            }

            throw new ApiError((error as Error).message || '网络请求失败');
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * HTTP GET 请求
     */
    async get<T = ApiResponse>(
        endpoint: string,
        options?: RequestOptions
    ): Promise<T> {
        return this.request<T>('GET', endpoint, undefined, options);
    }

    /**
     * HTTP POST 请求
     */
    async post<T = ApiResponse>(
        endpoint: string,
        data?: any,
        options?: RequestOptions
    ): Promise<T> {
        return this.request<T>('POST', endpoint, data, options);
    }

    /**
     * HTTP POST 请求 - 用于更新操作 (替代PUT/PATCH)
     */
    async update<T = ApiResponse>(
        endpoint: string,
        data?: any,
        options?: RequestOptions
    ): Promise<T> {
        return this.request<T>('POST', endpoint, data, options);
    }

    /**
     * HTTP POST 请求 - 用于删除操作 (替代DELETE)
     */
    async remove<T = ApiResponse>(
        endpoint: string,
        data?: any,
        options?: RequestOptions
    ): Promise<T> {
        return this.request<T>('POST', endpoint, data, options);
    }
}

// 创建API客户端实例
export const apiClient = new ApiClient(API_CONFIG.BASE_URL);

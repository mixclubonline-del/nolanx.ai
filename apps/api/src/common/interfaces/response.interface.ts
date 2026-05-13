export interface ApiResponse<T = any> {
    code: number;
    data: T;
    message: string;
    timestamp: string;
    path: string;
} 
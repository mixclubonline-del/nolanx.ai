import { UserMetadata } from '@supabase/supabase-js';
import { ClientInfo } from '../src/common/interfaces/client-info.interface';

declare global {
    namespace Express {
        interface Request {
            user: {
                id: string;
                [key: string]: any;
            };
            clientInfo: ClientInfo;
            requestId: string;
        }
    }
}

export {}; 
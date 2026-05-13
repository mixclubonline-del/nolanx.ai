export interface ToolCall {
    id: string
    type: string
    function: {
        name: string
        arguments: string
    }
}

export interface Message {
    role: 'user' | 'assistant' | 'system'
    content: string | any
    tool_calls?: ToolCall[]
    tool_call_id?: string
}
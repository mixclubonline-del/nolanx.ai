"""
Google Genai Document Analysis tools for LangGraph agents.
"""

import time
import io
import httpx
from typing import Optional, Annotated, List
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.websocket_service import send_session_update


class AnalyzeDocumentsInputSchema(BaseModel):
    document_urls: List[str] = Field(description="List of document URLs to analyze (PDF, DOC, etc.)")
    analysis_prompt: str = Field(description="What you want to analyze about the documents")
    comparison_mode: Optional[bool] = Field(
        default=False,
        description="Whether to compare multiple documents (true) or analyze individually (false)"
    )
    tool_call_id: str


@tool(args_schema=AnalyzeDocumentsInputSchema)
async def analyze_documents(
    document_urls: List[str],
    analysis_prompt: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    comparison_mode: Optional[bool] = False,
) -> str:
    """
    Analyze documents using Google Genai Document Analysis.
    
    Args:
        document_urls: List of document URLs to analyze
        analysis_prompt: What to analyze about the documents
        comparison_mode: Whether to compare documents or analyze individually
        config: Runtime configuration
        tool_call_id: Tool call identifier
        
    Returns:
        Success message with analysis results
    """
    try:
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        user_id = config.get('configurable', {}).get('user_id', '')
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        print(f'📄 Document analysis request:')
        print(f'   Documents: {len(document_urls)} files')
        print(f'   URLs: {document_urls}')
        print(f'   Analysis: {analysis_prompt}')
        print(f'   Comparison mode: {comparison_mode}')

        # Analyze documents with Genai
        analysis_result = await analyze_documents_with_genai(
            document_urls, analysis_prompt, comparison_mode
        )
        
        print(f'📄 Document analysis completed successfully')

        # Create success message (no canvas data generated)
        mode_text = "comparison" if comparison_mode else "individual analysis"
        success_message = f"📄 Document analysis completed successfully - Provider: Google Genai ({len(document_urls)} documents, {mode_text})"
        success_message += f"\n\n**Analysis Result:**\n{analysis_result['result']}"

        return success_message

    except Exception as e:
        error_message = f"❌ Document analysis failed: {str(e)}"
        print(error_message)
        return error_message


async def analyze_documents_with_genai(
    document_urls: List[str], 
    analysis_prompt: str, 
    comparison_mode: bool
) -> dict:
    """Analyze documents using Google Genai"""
    try:
        from google import genai
        
        # Get API key from config
        google_genai_config = config_service.get_service_config('google_genai')
        api_key = google_genai_config.get('api_key')

        if not api_key:
            raise ValueError("Google Genai API key not found in configuration")
        
        # Create client
        client = genai.Client(api_key=api_key)
        
        # Upload documents to Genai
        uploaded_files = []
        for url in document_urls:
            try:
                # Download document
                doc_data = io.BytesIO(httpx.get(url).content)
                
                # Determine MIME type based on URL extension
                if url.lower().endswith('.pdf'):
                    mime_type = 'application/pdf'
                elif url.lower().endswith('.doc'):
                    mime_type = 'application/msword'
                elif url.lower().endswith('.docx'):
                    mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                else:
                    mime_type = 'application/pdf'  # Default to PDF
                
                # Upload to Genai
                uploaded_file = client.files.upload(
                    file=doc_data,
                    config=dict(mime_type=mime_type)
                )
                uploaded_files.append(uploaded_file)
                print(f'📄 Uploaded document: {url}')
                
            except Exception as e:
                print(f'📄 Failed to upload document {url}: {str(e)}')
                continue
        
        if not uploaded_files:
            raise Exception("No documents could be uploaded successfully")
        
        # Prepare analysis prompt
        if comparison_mode and len(uploaded_files) > 1:
            prompt = f"Compare and analyze these documents: {analysis_prompt}"
        else:
            prompt = f"Analyze this document: {analysis_prompt}"
        
        # Generate analysis
        contents = uploaded_files + [prompt]
        response = client.models.generate_content(
            model="google/gemini-3-pro-preview",
            contents=contents
        )
        
        analysis_result = response.text
        
        # Encode result for data URL
        import base64
        encoded_result = base64.b64encode(analysis_result.encode('utf-8')).decode('utf-8')
        
        return {
            'result': analysis_result,
            'encoded_result': encoded_result,
            'uploaded_count': len(uploaded_files)
        }
        
    except Exception as e:
        print(f'📄 Document analysis error: {str(e)}')
        raise e




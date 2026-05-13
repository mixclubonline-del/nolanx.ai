"""
Voice Selector for intelligent voice selection based on content analysis
"""
import json
import os
import re
from typing import Tuple, List, Dict, Any


class VoiceSelector:
    """Intelligent voice selection based on content analysis"""
    
    def __init__(self):
        self.voices = self._load_voices()
        
    def _load_voices(self) -> List[Dict[str, Any]]:
        """Load voices from voices.json or use embedded data"""
        try:
            # Try to load from reelmind.server voices.json
            voices_path = os.path.join(
                os.path.dirname(__file__), 
                "..", "..", "..", "..", 
                "reelmind.server", "src", "sound", "voices.json"
            )
            
            if os.path.exists(voices_path):
                with open(voices_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    print(f"✅ Loaded {len(data)} voices from {voices_path}")
                    return data
        except Exception as e:
            print(f"⚠️ Failed to load voices.json: {e}")
            
        # Fallback to embedded voice data
        embedded_voices = [
            {
                "voice_id": "21m00Tcm4TlvDq8ikWAM",
                "name": "Rachel",
                "labels": {
                    "description": "calm, young female, narration",
                    "gender": "female",
                    "age": "young",
                    "accent": "american",
                    "use_case": "narration"
                }
            },
            {
                "voice_id": "29vD33N1CtxCmqQRPOHJ",
                "name": "Drew",
                "labels": {
                    "description": "well-rounded, middle-aged male, news",
                    "gender": "male", 
                    "age": "middle_aged",
                    "accent": "american",
                    "use_case": "news"
                }
            },
            {
                "voice_id": "CYw3kZ02Hs0563khs1Fj",
                "name": "Paul",
                "labels": {
                    "description": "authoritative, middle-aged male, news",
                    "gender": "male",
                    "age": "middle_aged", 
                    "accent": "american",
                    "use_case": "news"
                }
            },
            {
                "voice_id": "9BWtsMINqrJLrRacOk9x",
                "name": "Aria",
                "labels": {
                    "description": "husky, middle-aged female, educational",
                    "gender": "female",
                    "age": "middle_aged",
                    "accent": "american", 
                    "use_case": "educational"
                }
            },
            {
                "voice_id": "EXAVITQu4vr4xnSDxMaL",
                "name": "Sarah",
                "labels": {
                    "description": "professional, young female, entertainment",
                    "gender": "female",
                    "age": "young",
                    "accent": "american",
                    "use_case": "entertainment"
                }
            },
            {
                "voice_id": "FGY2WhTYpPnrIDTdsKH5",
                "name": "Laura",
                "labels": {
                    "description": "sassy, young female, social media",
                    "gender": "female", 
                    "age": "young",
                    "accent": "american",
                    "use_case": "social_media"
                }
            }
        ]
        
        print(f"✅ Using embedded voice data: {len(embedded_voices)} voices")
        return embedded_voices
        
    def select_best_voice(self, text: str) -> Tuple[str, str, List[str]]:
        """
        Select the best voice based on content analysis
        
        Args:
            text: The text to be spoken
            
        Returns:
            Tuple of (voice_id, voice_name, selection_reasons)
        """
        if not self.voices:
            # Fallback to Rachel
            return "21m00Tcm4TlvDq8ikWAM", "Rachel", ["fallback"]
            
        scores = {}
        reasons = {}
        
        # Analyze text content
        text_lower = text.lower()
        
        for voice in self.voices:
            voice_id = voice["voice_id"]
            voice_name = voice["name"]
            labels = voice.get("labels", {})
            
            score = 0
            voice_reasons = []
            
            # Content type analysis
            if any(word in text_lower for word in ["news", "report", "breaking", "update"]):
                if labels.get("use_case") == "news":
                    score += 3
                    voice_reasons.append("news content")
                    
            elif any(word in text_lower for word in ["learn", "education", "tutorial", "explain"]):
                if labels.get("use_case") == "educational":
                    score += 3
                    voice_reasons.append("educational content")
                    
            elif any(word in text_lower for word in ["story", "once upon", "narrative", "tale"]):
                if labels.get("use_case") == "narration":
                    score += 3
                    voice_reasons.append("narrative content")
                    
            elif any(word in text_lower for word in ["fun", "exciting", "amazing", "awesome"]):
                if labels.get("use_case") == "entertainment":
                    score += 2
                    voice_reasons.append("entertainment content")
                    
            # Tone analysis
            if any(word in text_lower for word in ["professional", "business", "corporate"]):
                if "professional" in labels.get("description", ""):
                    score += 2
                    voice_reasons.append("professional tone")
                    
            elif any(word in text_lower for word in ["calm", "peaceful", "relax"]):
                if "calm" in labels.get("description", ""):
                    score += 2
                    voice_reasons.append("calm tone")
                    
            elif any(word in text_lower for word in ["authority", "important", "serious"]):
                if "authoritative" in labels.get("description", ""):
                    score += 2
                    voice_reasons.append("authoritative tone")
                    
            # Length-based selection
            if len(text) > 500:  # Long content
                if labels.get("use_case") in ["narration", "educational"]:
                    score += 1
                    voice_reasons.append("suitable for long content")
            else:  # Short content
                if labels.get("use_case") in ["social_media", "entertainment"]:
                    score += 1
                    voice_reasons.append("suitable for short content")
                    
            # Default preferences
            if voice_name == "Rachel":  # Default preference
                score += 0.5
                voice_reasons.append("default preference")
                
            scores[voice_id] = score
            reasons[voice_id] = voice_reasons
            
        # Select the voice with highest score
        if scores:
            best_voice_id = max(scores.keys(), key=lambda x: scores[x])
            best_voice = next(v for v in self.voices if v["voice_id"] == best_voice_id)
            return best_voice_id, best_voice["name"], reasons[best_voice_id]
        else:
            # Fallback to first voice
            first_voice = self.voices[0]
            return first_voice["voice_id"], first_voice["name"], ["fallback"]


# Global instance
voice_selector = VoiceSelector()

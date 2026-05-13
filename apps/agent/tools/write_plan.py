from pydantic import BaseModel, Field
from typing import Optional, Annotated, List
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId


class Step(BaseModel):
    title: str
    description: Optional[str] = Field(
        default="",
        description="Description of the step",
    )

class StepsInput(BaseModel):
    steps: List[Step] = Field(
        default_factory=list,
        description="The list of steps, in the order of execution",
    )
    tool_call_id: Annotated[str, InjectedToolCallId]


@tool("write_plan", 
description="""
Write a plan to complete the current task in the order of execution, including the steps and the description of each step. 
The plan should be friendly to showcase to the user.

For story / animation / film / long-form video work, structure the plan around:
1. script creation or script refinement,
2. Script Track design with detailed 15-second storyboard rows and internal 1-2 second sub-beats; unless the user explicitly requests a sustained take, every 2 seconds should contain at least one meaningful subshot / camera beat,
   and the opening of the piece should usually begin on a key scene with strong dramatic behavior rather than neutral setup coverage,
3. world track design (characters, scenes, props, style anchors) with stable ids derived from the script rows,
4. world asset audition-video generation for recurring characters / locations / props,
5. formal 15-second video generation where each clip binds exact world asset ids and uses the relevant world-audition `@视频N（名字 / 类型）` anchors within the 15-second total reference-video budget, including location/world assets as explicit `@视频N` anchors,
6. final long-form assembly across many 15-second clips.

Across the whole plan, enforce one unified world aesthetic, one coherent dialogue language/register, and rich performance design including dialogue, reactions, and micro-expressions.

Aspect ratio planning is mandatory:
- 9:16 for phone-first vertical short dramas / mobile-native storytelling
- 2.39:1 for cinematic film language / premium movie-like visuals
- 16:9 for conventional horizontal ads, general web video, and standard delivery
- Choose one top-level ratio and keep it consistent through downstream execution.
""",
args_schema=StepsInput)
def write_plan_tool(
    steps: List[Step],
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> str:
    print("write_plan_tool")
    # Return plain content; LangChain/LangGraph will wrap this into a ToolMessage.
    return (
        "<hide_in_user_ui> Plan recorded. Proceed to execute the steps or hand off to a specialized agent."
    )

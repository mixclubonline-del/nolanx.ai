# services/stream_service.py

# Dictionary to store active stream tasks, keyed by session_id
stream_tasks = {}

def add_stream_task(session_id, task):
    """
    Add a stream task for the given session_id.

    Args:
        session_id (str): Unique identifier for the session.
        task: The task object to associate with the session.
    """
    stream_tasks[session_id] = task

def remove_stream_task(session_id):
    """
    Remove the stream task associated with the given session_id.

    Args:
        session_id (str): Unique identifier for the session.
    """
    stream_tasks.pop(session_id, None)

def get_stream_task(session_id):
    """
    Retrieve the stream task associated with the given session_id.

    Args:
        session_id (str): Unique identifier for the session.

    Returns:
        The task object if found, otherwise None.
    """
    return stream_tasks.get(session_id)

# 你也可以加一个 list_stream_tasks() 返回所有 session_id

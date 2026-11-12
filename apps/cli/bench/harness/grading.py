import datetime


def epoch_ms(iso_time):
    if not isinstance(iso_time, str):
        return None
    try:
        return datetime.datetime.fromisoformat(iso_time.replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return None


def reset_by_agent(check, baseline_reset_at_ms=None, sent_at_ms=None):
    reset_at = check.get("reset_at_ms")
    if reset_at is None:
        return False
    if baseline_reset_at_ms is not None:
        return reset_at != baseline_reset_at_ms
    if sent_at_ms is not None:
        return reset_at > sent_at_ms
    return False


def run_passed(check, reset, timed_out):
    return bool(check.get("pass")) and not reset and not timed_out


def grade(check, timed_out, baseline_reset_at_ms=None, sent_at_ms=None):
    reset = reset_by_agent(check, baseline_reset_at_ms, sent_at_ms)
    return run_passed(check, reset, timed_out), reset

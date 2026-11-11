import importlib.util
import io
from pathlib import Path
import struct
import threading
import unittest
from unittest.mock import Mock, patch
import wave

spec = importlib.util.spec_from_file_location("local_asr", Path(__file__).resolve().parents[1] / "src/asr/server.py")
asr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asr)


def wav(seconds=1, channels=1, rate=16000):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\0\0" * channels * rate * seconds)
    return output.getvalue()


def multipart(fields):
    body = b""
    for name, value in fields:
        body += b"--test\r\nContent-Disposition: form-data; name=\"" + name.encode() + b"\"\r\n\r\n" + value + b"\r\n"
    return body + b"--test--\r\n"


class LocalASRTests(unittest.TestCase):
    def test_pcm_limits(self):
        self.assertEqual(asr.parse_wav(wav())[1], 1)
        for body in [b"invalid", wav(channels=2), wav(rate=8000), wav(seconds=121), wav()[:-20]]:
            with self.assertRaises(ValueError):
                asr.parse_wav(body)

    def test_multipart_fields_and_binary(self):
        source = wav()
        result = asr.parse_multipart("multipart/form-data; boundary=test", multipart([("model", b"sensevoice-small-int8"), ("file", source)]))
        self.assertEqual(result["file"], source)
        for fields in [[("file", source), ("file", source)], [("file", source), ("model", b"unknown")], [("file", source), ("response_format", b"srt")], [("file", source), ("language", b"invalid")], [("file", source), ("timestamp_granularities[]", b"word")]]:
            with self.assertRaises(ValueError):
                asr.parse_multipart("multipart/form-data; boundary=test", multipart(fields))

    def test_idle_reaper_stops_only_idle_worker(self):
        manager = object.__new__(asr.ModelManager)
        manager.config = {"idle_seconds": 1}
        manager.lock = threading.Lock()
        manager.last_used = 0
        manager.closed = False
        def stop():
            manager.closed = True
        manager.stop = Mock(side_effect=stop)
        with patch.object(asr.time, "sleep"), patch.object(asr.time, "monotonic", return_value=100):
            manager.reap()
        manager.stop.assert_called_once()

    def test_windows_venv_shutdown_kills_owned_worker_tree(self):
        manager = object.__new__(asr.ModelManager)
        process = Mock()
        process.pid = 12345
        process.poll.side_effect = [None, 0]
        manager.process, manager.actual_pid = process, 67890
        with patch.object(asr.sys, "platform", "win32"), patch.object(asr.subprocess, "run") as run, patch.object(asr.subprocess, "CREATE_NO_WINDOW", 0, create=True):
            manager.stop()
        self.assertEqual(run.call_args.args[0][-4:], ["/PID", "12345", "/T", "/F"])
        self.assertIsNone(manager.process)
        self.assertIsNone(manager.actual_pid)
        process.wait.assert_called_once()


if __name__ == "__main__":
    unittest.main()

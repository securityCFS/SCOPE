"""Linux tests of real spool controls against an isolated fake ACP subprocess."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest

base_path = Path(__file__).with_name("claude-interactive.test.py")
spec = importlib.util.spec_from_file_location("scope_test_base", base_path)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
providers = base_path.parents[1] / "bridge/providers"
forms = (providers / "acp-forms.py").read_text()
base.SOURCE = "import types,sys\nm=types.ModuleType('scope_acp_forms')\nexec(" + repr(forms) + ",m.__dict__)\nsys.modules[m.__name__]=m\n" + (providers / "antigravity-interactive.py").read_text()
base.FAKE = r'''#!/usr/bin/env python3
import json, sys
def emit(value): print(json.dumps(dict(jsonrpc='2.0',**value)),flush=True)
def answer(i,result):emit(dict(id=i,result=result))
turn=0
for line in sys.stdin:
 v=json.loads(line);method=v.get('method');p=v.get('params',{})
 if method=='initialize':
  assert p['clientCapabilities']['elicitation']=={'form':{}}
  answer(v['id'],{'protocolVersion':1})
 elif method in ('session/new','session/load'):answer(v['id'],{'sessionId':'test-session'})
 elif method in ('session/set_model','session/set_mode','session/set_config_option'):answer(v['id'],{})
 elif method=='session/prompt':
  turn+=1;prompt_id=v['id'];text=p['prompt'][0]['text']
  if text=='stop-test':continue
  if turn>1:answer(prompt_id,{'stopReason':'end_turn'});continue
  if text=='permission-test':
   emit(dict(id=90,method='session/request_permission',params={'sessionId':'test-session','toolCall':{'title':'Write test','rawInput':{'path':'/tmp/test'}},'options':[{'optionId':'once','name':'Allow once','kind':'allow_once'},{'optionId':'no','name':'Reject','kind':'reject_once'}]}))
  else:
   emit(dict(id=90,method='elicitation/create',params={'sessionId':'test-session','mode':'form','message':'Choose colors','requestedSchema':{'type':'object','properties':{'colors':{'type':'array','items':{'anyOf':[{'const':'1','title':'Red'},{'const':'3','title':'Green'}]},'minItems':2}},'required':['colors']}}))
 elif method=='session/cancel':answer(prompt_id,{'stopReason':'cancelled'})
 elif v.get('id')==90 and 'result' in v:
  result=v['result']
  if result.get('action')=='accept':assert result['content']=={'colors':['1','3']}
  if result.get('outcome',{}).get('outcome')=='selected':assert result['outcome']['optionId'] in ['once','no']
  emit(dict(method='session/update',params={'sessionId':'test-session','update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':json.dumps(result)}}}))
  answer(prompt_id,{'stopReason':'end_turn'})
'''

class AcpTest(unittest.TestCase):
    setUp = base.InteractiveTest.setUp
    start = base.InteractiveTest.start
    cleanup_worker = base.InteractiveTest.cleanup_worker
    wait = base.InteractiveTest.wait
    control = base.InteractiveTest.control

    def test_multi_select_invalid_answer_retains_pending_then_success(self):
        self.start()
        self.wait(lambda v: v["status"] == "waiting_permission")
        rid = self.control("permission", requestId="90", decision="allow", content={"colors":["bogus"]})
        invalid = self.wait(lambda v: any(c["id"] == rid for c in v["controlResults"]))
        self.assertEqual(invalid["controlResults"][-1]["status"], "rejected")
        self.assertEqual(len(invalid["permissions"]), 1)
        self.control("permission", requestId="90", decision="allow", content={"colors":["1","3"]})
        self.assertEqual(json.loads(self.wait(lambda v: v["status"] == "completed")["text"])["content"], {"colors":["1","3"]})

    def test_decline_and_cancel_are_distinct(self):
        self.start()
        self.wait(lambda v: v["status"] == "waiting_permission")
        self.control("permission", requestId="90", decision="cancel")
        self.assertEqual(json.loads(self.wait(lambda v: v["status"] == "completed")["text"])["action"], "cancel")

    def test_permission_option_and_queued_followup(self):
        self.start("permission-test")
        self.wait(lambda v: v["status"] == "waiting_permission")
        self.control("message", prompt="follow up")
        self.control("permission", requestId="90", decision="allow", optionId="once")
        done = self.wait(lambda v: v["status"] == "completed")
        self.assertEqual(json.loads(done["text"])["outcome"]["optionId"], "once")
        self.assertTrue(any(e.get("text") == "follow up" for e in done["events"]))

    def test_stop_cancels_pending_form_without_touching_external_process(self):
        external = subprocess.Popen(["sleep", "30"])
        self.addCleanup(lambda: (external.terminate(), external.wait()))
        self.start()
        self.wait(lambda v: v["status"] == "waiting_permission")
        self.control("stop")
        done = self.wait(lambda v: v["status"] == "stopped")
        self.assertFalse(done["permissions"])
        self.assertIsNone(external.poll())

if __name__ == "__main__": unittest.main()

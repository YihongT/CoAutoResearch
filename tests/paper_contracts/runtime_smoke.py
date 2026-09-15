#!/usr/bin/env python3
"""Synthetic V2Runtime integration smoke checks.

This exercises the real runtime stage/review/merge/transaction/publication path
using synthetic artifacts and synthetic passing reviewer outputs. It is not a
scientific evaluation and does not invoke a coding agent or UI.
"""
from __future__ import annotations
import argparse, hashlib, json, os, shutil, sys, tempfile
from copy import deepcopy
from pathlib import Path

STAMP='2026-07-14T12:00:00Z'
PROJECT='coar-demo'
TRIAL='000001_test-main-signal'
STAGE='STAGE-000001-aaaaaaaa'

def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def run(repo: Path, *, invalid_cp: bool=False) -> dict:
    template=repo/'templates/default'
    sys.path.insert(0,str(template/'ui'))
    os.environ['COAUTO_SCHEMA_DIR']=str(template/'schemas')
    from v2_runtime import V2Runtime
    from v2_artifacts import result_card_payload_hash
    from v2_contracts import canonical_json_bytes

    def ex(name: str):
        paths=list(template.rglob(name+'.example.json'))
        if len(paths)!=1:
            raise AssertionError(f'expected one {name}.example.json, got {paths}')
        return json.loads(paths[0].read_text(encoding='utf-8'))

    with tempfile.TemporaryDirectory(prefix='coar-runtime-smoke-') as td, \
         tempfile.TemporaryDirectory(prefix='coar-plan-guard-') as initial_guard, \
         tempfile.TemporaryDirectory(prefix='coar-exec-guard-') as execution_guard, \
         tempfile.TemporaryDirectory(prefix='coar-review-guard-') as review_guard:
        root=Path(td)/'project'
        shutil.copytree(template,root)
        rt=V2Runtime(root,PROJECT)

        state=ex('PROJECT_STATE')
        state.update(canonical_revision=0,active_line_id='L0001',
            critical_path=[{'id':'CP1','description':'Establish the main signal.','status':'open','source':'L0001/current_bottleneck'}],
            goal_gate_path=None,next_step='Test the main signal.')
        findings=ex('CURRENT_FINDINGS')
        findings.update(canonical_revision=0,accepted_card_ids=[],qualified_card_ids=[],superseded_card_ids=[],synthesis=[])
        line=ex('LINE')
        line.update(last_published_revision=0,supporting_cards=[],limiting_cards=[],conflicting_cards=[],material_exclusions=[],current_bottleneck='Establish the main signal.')
        campaign=ex('CAMPAIGN')
        campaign.update(last_published_revision=0,aggregate_status='in_progress',current_blockers=['Main signal not yet established.'])
        campaign['components'][0].update(component_id='main_signal',title='Establish the main signal',status='not_started',satisfying_card_ids=[],rationale='Synthetic fixture.')
        rt._write_pair('research_trajectory/STATE.json',state)
        rt._write_pair('research_trajectory/CURRENT_FINDINGS.json',findings)
        rt._write_pair('research_trajectory/lines/L0001.json',line)
        rt._write_pair('research_trajectory/campaigns/C0001.json',campaign)

        trial=ex('TRIAL')
        trial.update(base_revision=0,stage_id=None,lifecycle_state='planned',publish_revision=None,trial_outcome=None,closed_at=None)
        rt._write_artifact(f'research_trajectory/trials/{TRIAL}/TRIAL.json',trial)
        init=rt.initialize_trial(TRIAL,agent_guard_dir=initial_guard,stage_id=STAGE)
        assert init['status']=='plan_ready',init

        plan=ex('PLAN')
        plan['critical_path_target']='CP404' if invalid_cp else 'CP1'
        plan['active_line_ids']=['L0001']; plan['campaign_ids']=['C0001']
        route=ex('EXPERT_ROUTE'); route['review_triggers']=[]
        rt._write_pair(f'research_trajectory/trials/{TRIAL}/PLAN.json',plan)
        rt._write_pair(f'research_trajectory/trials/{TRIAL}/EXPERT_ROUTE.json',route)
        plan_bytes=(root/f'research_trajectory/trials/{TRIAL}/PLAN.json').read_bytes()
        plan_review=ex('REVIEWER_OUTPUT')
        plan_review.update(review_id='RV-000001-plan-01',reviewer='plan',scope='plan',phase='pre_execution',decision='pass',
            summary='Synthetic plan-review smoke fixture.',stage_id=None,stage_manifest_hash=None,gate_effect='none',
            instruction_file='instructions/reviewers/PLAN_REVIEWER.md',
            reviewed_inputs=[f'research_trajectory/trials/{TRIAL}/PLAN.json',f'research_trajectory/trials/{TRIAL}/EXPERT_ROUTE.json'],
            evidence_checked=[],strengths=[],blockers=[],required_actions=[],qualified_partial_passes=[],unassessed_areas=[],human_task_candidates=[],response_to_human=None)
        plan_review['extensions']={'plan_binding':{'plan_revision':1,'plan_sha256':sha(plan_bytes)}}
        rt._write_pair(f'research_trajectory/trials/{TRIAL}/reviews/PLAN_REVIEW.json',plan_review)
        approval=rt.approve_plan(TRIAL,STAGE,plan_guard_dir=initial_guard,agent_guard_dir=execution_guard,created_at=STAMP)
        if invalid_cp:
            assert approval['status']=='plan_rejected',approval
            assert any('critical_path_target' in e for e in approval.get('errors',[])),approval
            assert not (root/f'research_trajectory/.staging/{TRIAL}/{STAGE}/PLAN_APPROVAL.json').exists()
            return {'mode':'invalid_cp','status':'passed','approval_status':approval['status'],'errors':approval.get('errors',[])}
        assert approval['status']=='execution_ready',approval

        evidence_rel=f'research_trajectory/trials/{TRIAL}/artifacts/results.json'
        evidence_bytes=canonical_json_bytes({'synthetic_runtime_smoke':True,'scientific_result':None})
        evidence_path=root/evidence_rel; evidence_path.parent.mkdir(parents=True,exist_ok=True); evidence_path.write_bytes(evidence_bytes)
        evidence_hash=sha(evidence_bytes)
        report=ex('REPORT')
        report.update(summary='Synthetic runtime publication smoke only.',work_performed=['Exercised V2Runtime publication path.'],procedures=[],
            findings=['Synthetic software-path finding.'],negative_results=[],limitations=['Not scientific evidence.'],interpretation='Software path only.',
            line_effects=[],campaign_effects=[{'campaign_id':'C0001','component_id':'main_signal','proposed_status':'tentative','rationale':'Synthetic fixture.'}],
            venue_impact='No venue change.')
        report['artifacts']=[{'path':evidence_rel,'role':'primary_result','sha256':evidence_hash,'extensions':{}}]
        cards=ex('RESULT_CARDS'); card=cards['cards'][0]
        card.update(type='process_lesson',claim_ids=[],effect='informs',summary='Synthetic software-path result.')
        card['evidence'][0]['path']=evidence_rel; card['evidence'][0]['sha256']=evidence_hash
        card['content_hash']=result_card_payload_hash(card)
        request=ex('MERGE_REQUEST')
        request.update(stage_id=STAGE,staged_update_manifest_path=f'research_trajectory/.staging/{TRIAL}/{STAGE}/STAGED_UPDATE_MANIFEST.json',
            requested_line_updates=[],requested_campaign_updates=['C0001/main_signal -> tentative'],summary='Synthetic runtime smoke merge.')
        rt._write_pair(f'research_trajectory/trials/{TRIAL}/REPORT.json',report)
        rt._write_pair(f'research_trajectory/trials/{TRIAL}/RESULT_CARDS.json',cards)
        rt._write_pair(f'research_trajectory/trials/{TRIAL}/MERGE_REQUEST.json',request)

        stage_root=f'research_trajectory/.staging/{TRIAL}/{STAGE}'
        brief=ex('HUMAN_BRIEF')
        brief['evidence'][0]['path']=evidence_rel; brief['evidence'][0]['sha256']=evidence_hash
        brief.update(line_impact='No Research Line claim was changed by this synthetic smoke run.',campaign_impact='C0001 main_signal proposed tentative.',one_line_outcome='Synthetic runtime smoke produced one proposed result.')
        gate=ex('GATE_EVIDENCE'); gate.update(final_ready=False,recommended_status='continue',reasons=['Synthetic smoke leaves real research incomplete.'])
        rt._write_pair(f'{stage_root}/HUMAN_BRIEF.json',brief)
        rt._write_pair(f'{stage_root}/GATE_EVIDENCE.json',gate)

        candidate_findings=deepcopy(findings)
        candidate_findings.update(canonical_revision=1,qualified_card_ids=['RC-000001-01'],
            synthesis=[{'finding_id':'F0001','statement':'Synthetic runtime smoke finding.','status':'accepted_with_qualification','card_ids':['RC-000001-01']}])
        candidate_campaign=deepcopy(campaign)
        candidate_campaign['last_published_revision']=1
        candidate_campaign['components'][0].update(status='tentative',satisfying_card_ids=['RC-000001-01'],rationale='Synthetic smoke result.')
        candidate_campaign.update(aggregate_status='tentative',current_blockers=['Replication remains missing.'])
        candidate_root=f'{stage_root}/candidate'
        rt._write_pair(f'{candidate_root}/research_trajectory/CURRENT_FINDINGS.json',candidate_findings)
        rt._write_pair(f'{candidate_root}/research_trajectory/campaigns/C0001.json',candidate_campaign)

        route_inputs={
            'target':'evaluation','line_effect':'no_change','new_or_changed_claim':False,
            'campaign_component_promoted_beyond_in_progress':True,
            'external_sources_or_new_citations':False,'target_venue_configured_or_venue_impact':False,
            'manuscript_or_claim_hierarchy_changed':False,'active_figure_or_table_changed':False,
            'central_line_effect_not_no_change':False,'campaign_component_marked_passed_or_waived':False,
            'target_venue_lock_change_requested':False,'gate_candidate_pass':False,'final_candidate':False,
            'high_risk_ethics_legal_human_subjects':False,'venue_impact':False,
            'agent_requested_level':'standard','enabled_registries':[]}
        staged=rt.stage_trial(TRIAL,STAGE,agent_guard_dir=execution_guard,review_guard_dir=review_guard,route_inputs=route_inputs,created_at=STAMP)
        assert staged['status']=='needs_review',staged
        manifest=staged['review_manifest']
        for reviewer,path in staged['review_output_paths'].items():
            if reviewer=='plan': continue
            review=ex('REVIEWER_OUTPUT')
            review.update(reviewer=reviewer,scope=reviewer,review_id=f'RV-000001-{reviewer}-01',phase='post_stage',decision='pass',
                summary=f'Synthetic {reviewer} runtime smoke review.',stage_id=STAGE,stage_manifest_hash=manifest['stage_manifest_hash'],gate_effect='none',
                reviewed_inputs=[f'research_trajectory/trials/{TRIAL}/REPORT.json',f'research_trajectory/trials/{TRIAL}/RESULT_CARDS.json',f'{stage_root}/STAGED_UPDATE_MANIFEST.json'],
                strengths=[],blockers=[],required_actions=[],qualified_partial_passes=[],unassessed_areas=[],human_task_candidates=[],response_to_human=None)
            review['extensions']={'card_eligibility':[{'card_id':'RC-000001-01','requested_decision':'accept_with_qualification','eligible':True,'reason':'Synthetic exact-stage runtime smoke eligibility.'}]}
            review['evidence_checked']=[{'path':evidence_rel,'sha256':evidence_hash,'source_kind':'artifact','scope':'synthetic software path','description':'Synthetic smoke artifact','extensions':{}}]
            review['instruction_file']=f"instructions/reviewers/{'PROCESS_REVIEWER.md' if reviewer=='process' else 'EVIDENCE_REVIEWER.md'}"
            rt._write_pair(path,review)

        completed=rt.complete_trial(TRIAL,STAGE,review_guard_dir=review_guard,gate_projection={},created_at=STAMP,publish=True)
        assert completed['status']=='published' and completed.get('published') is True,completed
        receipt=json.loads((root/f'research_trajectory/trials/{TRIAL}/PUBLISH_RECEIPT.json').read_text())
        revision=json.loads((root/'research_trajectory/CANONICAL_REVISION.json').read_text())
        final_findings=json.loads((root/'research_trajectory/CURRENT_FINDINGS.json').read_text())
        assert receipt['published_revision']==revision['revision']==1
        assert receipt['transaction_id']==revision['transaction_id']
        assert 'RC-000001-01' in final_findings['qualified_card_ids']
        return {
            'mode':'publication','status':'passed','approval_status':approval['status'],
            'stage_status':staged['status'],'completion_status':completed['status'],
            'published_revision':revision['revision'],'transaction_id':revision['transaction_id'],
            'gate_status':completed['goal_gate']['status'],
            'qualified_card_ids':final_findings['qualified_card_ids'],
            'published_paths':[x['path'] for x in receipt['published_files']],
        }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--repo',type=Path,required=True)
    ap.add_argument('--invalid-cp',action='store_true')
    ap.add_argument('--output',type=Path)
    args=ap.parse_args()
    result=run(args.repo.resolve(),invalid_cp=args.invalid_cp)
    text=json.dumps(result,indent=2,sort_keys=True)+'\n'
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(text,encoding='utf-8')
    print(text,end='')

if __name__=='__main__': main()

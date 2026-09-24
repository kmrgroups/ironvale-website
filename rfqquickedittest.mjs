import fs from 'fs';
const s=fs.readFileSync('./idms.html','utf8');
const must=[
  'rfqQuickEditOpen','rfqQuickEditSave','rfqQuickEditDelete',
  'rpq-char-edit','rpq-char-del','rpq-char-add','rpq-char-save','rpq-char-cancel',
  '+ Add characteristic','rfqPlaceAutoPos','calloutW:c.calloutBBox'
];
for(const x of must) if(!s.includes(x)) throw new Error('Missing RFQ quick-edit contract: '+x);
console.log('RFQ quick-edit UI test: PASS');

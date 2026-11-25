module.exports = {
  title: 'Explore a workshop budget',
  summary: 'Example assumptions: $300 for the room, $25 per person, and optional $120 materials.',
  messages: [{version:'1.0',createSurface:{
    surfaceId:'budget',catalogId:'https://clay.studio/a2ui/exploration/v1',
    dataModel:{people:10,materials:false,note:'A small workshop'},
    components:[
      {id:'root',component:'Column',children:['people','materials','total','tabs']},
      {id:'people',component:'Slider',label:'Participants',min:5,max:30,steps:25,value:{'@path':'/people'}},
      {id:'materials',component:'CheckBox',label:'Include materials',value:{'@path':'/materials'}},
      {id:'total',component:'Text',text:{'@call':'join',args:{values:['Estimated total: ',{'@call':'number',args:{currency:'USD',value:{'@call':'calculate',args:{operation:'add',values:[300,{'@call':'calculate',args:{operation:'multiply',values:[25,{'@path':'/people'}]}},{'@call':'choose',args:{condition:{'@path':'/materials'},yes:120,no:0}}]}}}}]}}},
      {id:'tabs',component:'Tabs',tabs:[{title:'Assumptions',child:'assumptions'},{title:'Your draft',child:'draft'}]},
      {id:'assumptions',component:'Card',child:'list'},
      {id:'list',component:'List',children:['room','divider','perperson']},
      {id:'room',component:'Text',text:'Room: $300. This is a fictional planning example.'},
      {id:'divider',component:'Divider',axis:'horizontal'},
      {id:'perperson',component:'Text',text:'Food: $25 per person. Materials: $120 when selected.'},
      {id:'draft',component:'Row',children:['note','echo']},
      {id:'note',component:'TextField',label:'Working title',value:{'@path':'/note'}},
      {id:'echo',component:'Text',text:{'@path':'/note'}},
    ],
  }}],
};

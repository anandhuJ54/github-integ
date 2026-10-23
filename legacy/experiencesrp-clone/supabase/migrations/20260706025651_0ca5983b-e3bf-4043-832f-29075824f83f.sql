UPDATE exp_category_schema_type SET schema_type='MotorcycleDealer', confidence='corrected' WHERE gcid IN
 ('gcid:bmw_motorcycle_dealer','gcid:electric_motorcycle_dealer','gcid:indian_motorcycle_dealer',
  'gcid:kawasaki_motorcycle_dealer','gcid:motorcycle_shop');
UPDATE exp_category_schema_type SET schema_type='MotorcycleRepair', confidence='corrected' WHERE gcid='gcid:motorcycle_repair_shop';
UPDATE exp_category_schema_type SET schema_type='RecyclingCenter', confidence='corrected' WHERE gcid IN
 ('gcid:salvage_dealer','gcid:scrap_metal_dealer');
UPDATE exp_category_schema_type SET schema_type='Organization', confidence='corrected' WHERE gcid IN
 ('gcid:energy_supplier','gcid:green_energy_supplier');
UPDATE exp_category_schema_type SET schema_type='Hospital', confidence='corrected' WHERE gcid='gcid:hospital_department';

UPDATE exp_category_knowledge SET entity_type='both' WHERE gcid IN
 ('gcid:arborist_and_tree_surgeon','gcid:cardiologist','gcid:certified_public_accountant',
  'gcid:chartered_accountant','gcid:child_psychologist','gcid:commercial_agent','gcid:cosmetic_dentist',
  'gcid:emergency_veterinarian_service','gcid:event_planner','gcid:exhibition_planner','gcid:insurance_agent',
  'gcid:neuropsychologist','gcid:party_planner','gcid:pediatric_cardiologist','gcid:pediatric_dermatologist',
  'gcid:pediatric_endocrinologist','gcid:pediatric_gastroenterologist','gcid:pediatric_hematologist',
  'gcid:pediatric_nephrologist','gcid:pediatric_neurologist','gcid:pediatric_oncologist',
  'gcid:pediatric_ophthalmologist','gcid:pediatric_pulmonologist','gcid:pediatric_rheumatologist',
  'gcid:pediatric_urologist','gcid:visa_consultant','gcid:wedding_planner');
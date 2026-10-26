CREATE POLICY "Staff read seller photos" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'seller-photos');
CREATE POLICY "Staff upload seller photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'seller-photos');
CREATE POLICY "Staff update seller photos" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'seller-photos') WITH CHECK (bucket_id = 'seller-photos');
CREATE POLICY "Staff delete seller photos" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'seller-photos');
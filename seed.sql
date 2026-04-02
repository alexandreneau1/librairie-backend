\encoding UTF8
SET client_encoding = 'UTF8';

-- ─────────────────────────────────────────────────────────────────────────────
-- BOOKDOG — Données de test
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM selections;
DELETE FROM avis;
DELETE FROM wishlist;
DELETE FROM livres WHERE isbn IN (
  '9782070360024','9782070408504','9782253004226','9782070413119',
  '9782072885730','9782072991000','9782253258094','9782877068628',
  '9782253933656','9782266320610','9782290219485','9782070454563',
  '9782075201803','9782253935650','9782075213980','9782266326070',
  '9782290382028','9782253004509','9782070413225','9782253009603'
);

INSERT INTO livres (titre, auteur, isbn, prix, stock, genre, editeur, collection, description) VALUES
('L''Etranger',               'Albert Camus',             '9782070360024', 7.90,  3, 'Roman',                  'Gallimard',       'Folio',          'Un homme indifferent au monde commet un meurtre absurde sur une plage algerienne.'),
('Le Petit Prince',           'Antoine de Saint-Exupery', '9782070408504', 8.50,  4, 'Roman',                  'Gallimard',       'Folio',          'Un aviateur echoue dans le desert rencontre un mysterieux petit prince venu d''une autre planete.'),
('Les Miserables',            'Victor Hugo',               '9782253004226', 14.90, 2, 'Roman',                  'Le Livre de Poche','Classiques',    'L''histoire de Jean Valjean, ancien forcat qui cherche a se racheter dans une France du XIXe siecle.'),
('Madame Bovary',             'Gustave Flaubert',          '9782070413119', 9.20,  0, 'Roman',                  'Gallimard',       'Folio',          'Emma Bovary se consume dans des reves romantiques qui la meneront a sa perte.'),
('La Peste',                  'Albert Camus',              '9782072885730', 8.90,  5, 'Roman',                  'Gallimard',       'Folio',          'Dans la ville d''Oran frappee par une epidemie, des hommes luttent contre l''absurde et la mort.'),
('Memoire de fille',          'Annie Ernaux',              '9782072991000', 11.50, 1, 'Roman',                  'Gallimard',       'Folio',          'Annie Ernaux revient sur l''ete 1958 qui marqua le passage brutal de l''adolescence a la vie adulte.'),
('Le Da Vinci Code',          'Dan Brown',                 '9782253258094', 10.90, 6, 'Thriller',               'Pocket',          NULL,             'Un expert en symbologie est mele a un meurtre au Louvre et decouvre un secret qui ebranlera la chretiente.'),
('La Verite sur l''affaire Harry Quebert', 'Joel Dicker', '9782877068628', 11.50, 3, 'Policier',               'Pocket',          NULL,             'Marcus Goldman enquete pour innocenter son mentor, accuse du meurtre d''une jeune fille disparue 33 ans plus tot.'),
('Les Enquetes de Maigret',   'Georges Simenon',           '9782253933656', 9.50,  2, 'Policier',               'Le Livre de Poche','Policier',      'Le commissaire Maigret resout ses affaires avec patience dans le Paris de l''entre-deux-guerres.'),
('Dune',                      'Frank Herbert',             '9782266320610', 13.50, 4, 'Science-fiction',        'Pocket',          'Science-fiction','Sur la planete desertique Arrakis, Paul Atreides decouvre sa destinee au coeur d''un empire galactique.'),
('Le Seigneur des Anneaux',   'J.R.R. Tolkien',            '9782290219485', 29.90, 2, 'Fantasy',                'Pocket',          NULL,             'Frodon Sacquet entreprend un voyage perilleux pour detruire l''Anneau Unique et sauver la Terre du Milieu.'),
('Fondation',                 'Isaac Asimov',              '9782070454563', 9.80,  0, 'Science-fiction',        'Gallimard',       'Folio SF',       'Hari Seldon developpe la psychohistoire pour preserver la connaissance humaine.'),
('Sapiens',                   'Yuval Noah Harari',         '9782075201803', 13.90, 7, 'Histoire',               'Albin Michel',    NULL,             'Une breve histoire de l''humanite, des premiers Homo sapiens a nos jours.'),
('Le Pouvoir du moment present','Eckhart Tolle',           '9782253935650', 10.90, 3, 'Developpement personnel','Pocket',          NULL,             'Comment vivre pleinement dans l''instant present pour trouver la paix interieure.'),
('Harry Potter a l''ecole des sorciers','J.K. Rowling',   '9782075213980', 9.90,  8, 'Jeunesse',               'Gallimard',       'Folio Junior',   'Harry Potter decouvre qu''il est un sorcier et integre l''ecole de magie Poudlard.'),
('Le Lion, la Sorciere Blanche et l''Armoire Magique','C.S. Lewis','9782266326070',8.90,5,'Jeunesse',          'Pocket',          'Junior',         'Quatre enfants decouvrent un monde magique au fond d''une armoire.'),
('Asterix le Gaulois',        'Goscinny & Uderzo',         '9782290382028', 10.95, 6, 'Bande dessinee',         'Hachette',        NULL,             'Un irreductible village gaulois resiste a l''envahisseur romain grace a la potion magique.'),
('Le Journal d''Anne Frank',  'Anne Frank',                '9782253004509', 8.90,  4, 'Biographie',             'Le Livre de Poche','Document',      'Le journal intime d''une jeune fille juive cachee a Amsterdam pendant l''occupation nazie.'),
('Les Fleurs du Mal',         'Charles Baudelaire',        '9782070413225', 7.50,  2, 'Poesie',                 'Gallimard',       'Folio',          'Recueil de poemes explorant la beaute, le mal et le spleen dans le Paris du XIXe siecle.'),
('Orgueil et Prejuges',       'Jane Austen',               '9782253009603', 9.20,  3, 'Romance',                'Le Livre de Poche','Classiques',    'Elizabeth Bennet et Mr Darcy doivent surmonter leurs prejuges pour trouver l''amour.');

-- ─── Coups de coeur ──────────────────────────────────────────────────────────
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'coup_de_coeur', 'Le coup de coeur de Thomas', TRUE FROM livres WHERE isbn = '9782253009603';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'coup_de_coeur', 'Recommande par Marie', TRUE FROM livres WHERE isbn = '9782075213980';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'coup_de_coeur', 'Incontournable selon Julie', TRUE FROM livres WHERE isbn = '9782075201803';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'coup_de_coeur', 'Recommande par Sarah', TRUE FROM livres WHERE isbn = '9782266320610';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'coup_de_coeur', 'Le choix de Thomas', TRUE FROM livres WHERE isbn = '9782072885730';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'coup_de_coeur', 'Recommande par Marie', TRUE FROM livres WHERE isbn = '9782070360024';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'coup_de_coeur', 'Le coup de coeur de Julie', TRUE FROM livres WHERE isbn = '9782877068628';

-- ─── Top ventes ──────────────────────────────────────────────────────────────
INSERT INTO selections (livre_id, type, rang, actif)
SELECT id, 'top_vente', 1, TRUE FROM livres WHERE isbn = '9782075201803';
INSERT INTO selections (livre_id, type, rang, actif)
SELECT id, 'top_vente', 2, TRUE FROM livres WHERE isbn = '9782070408504';
INSERT INTO selections (livre_id, type, rang, actif)
SELECT id, 'top_vente', 3, TRUE FROM livres WHERE isbn = '9782253258094';
INSERT INTO selections (livre_id, type, rang, actif)
SELECT id, 'top_vente', 4, TRUE FROM livres WHERE isbn = '9782266320610';
INSERT INTO selections (livre_id, type, rang, actif)
SELECT id, 'top_vente', 5, TRUE FROM livres WHERE isbn = '9782070360024';
INSERT INTO selections (livre_id, type, rang, actif)
SELECT id, 'top_vente', 6, TRUE FROM livres WHERE isbn = '9782075213980';
INSERT INTO selections (livre_id, type, rang, actif)
SELECT id, 'top_vente', 7, TRUE FROM livres WHERE isbn = '9782290219485';
INSERT INTO selections (livre_id, type, rang, actif)
SELECT id, 'top_vente', 8, TRUE FROM livres WHERE isbn = '9782877068628';

-- ─── Prix litteraires ─────────────────────────────────────────────────────────
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'prix', 'Prix Nobel de Litterature 1957', TRUE FROM livres WHERE isbn = '9782070360024';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'prix', 'Prix Nobel de Litterature 1957', TRUE FROM livres WHERE isbn = '9782072885730';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'prix', 'Prix Nobel de Litterature 2022', TRUE FROM livres WHERE isbn = '9782072991000';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'prix', 'Prix des Libraires', TRUE FROM livres WHERE isbn = '9782877068628';
INSERT INTO selections (livre_id, type, label, actif)
SELECT id, 'prix', 'Hugo Award - Meilleur roman', TRUE FROM livres WHERE isbn = '9782266320610';

-- ─── Verification ─────────────────────────────────────────────────────────────
SELECT 'Livres :' as info, COUNT(*) as total FROM livres;
SELECT 'Selections :' as info, COUNT(*) as total FROM selections;
SELECT type, COUNT(*) as nb FROM selections GROUP BY type ORDER BY type;

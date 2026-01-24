Une application avec pwa pour gérer les chambres et arrivés/départs d'une maison de vacances.

Pitch: Vous êtes en vacances avec plusieurs copains et vous louez une maison. Kikoushou vous permet d'attribuer les chambres et de ne pas oublier d'aller chercher ou amener vos amis à la gare.

Idées d'ajout:
- notification quand il fait partir récupéré / amener qq1 a la gare
- gestion de la nourriture / menu des repas.
- gestion de l'argent(tricount)
- gestion des tâches à faire (ménage, courses,...)

# Les écrans
## le calendrier

Il faut un calendrier pour avoir une vision globale de qui dors où et quand.
Par exemple une page de calendrier sur 1mois avec des événement pour chaque personne.
Description de l'événement : nom+chambre.

## les chambres

Une vue ses chambres qui permet d'affiner l'attribution des chambres pour éviter au maximum le changement de chambres.
Une colonne par chambres avec l'occupation et pouvoir regrouper les utilisations de chambres en fonction des personnes (optimisation avec l'ia?)

# spec technique
- Using the best web framework (+Bun )
- Tout se fait en local (chez le client) avec possibilité de sync avec serveur
distant (local ddb + postgres sync) possible. (comment faire en p2p ?)
- Un voyage peut être partagé avec les amis (rbac ?)
- Possibilité d'affichage sur tablette eink (kindle Par ex)

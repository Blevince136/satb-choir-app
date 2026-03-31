param(
    [string]$Message = "Project update"
)

git add -A
git commit -m $Message
git push origin main
